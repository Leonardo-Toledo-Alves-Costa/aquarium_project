// aquarium-audio: captura o áudio de programas específicos do Windows para a transmissão.
//
// Usa a captura por processo do Windows (process loopback, Windows 10 build 20348+ / Windows 11).
// Saída em stdout: PCM 16 bits, 48 kHz, estéreo intercalado, em blocos de 10 ms.
//
//   aquarium-audio sessions
//       lista os programas com sessão de áudio (pid, nome, estado).
//   aquarium-audio app --window <hwnd> --parent <pid> [--block a.exe,b.exe]
//       só o programa dono da janela (e os processos filhos dele).
//   aquarium-audio all --parent <pid> [--block a.exe,b.exe]
//       todos os programas tocando, menos os bloqueados e o processo <parent> com seus filhos.

#define NOMINMAX
#include <windows.h>
#include <audioclient.h>
#include <audioclientactivationparams.h>
#include <audiopolicy.h>
#include <fcntl.h>
#include <io.h>
#include <mmdeviceapi.h>
#include <tlhelp32.h>
#include <wrl/implements.h>

#include <algorithm>
#include <atomic>
#include <cstdio>
#include <cwctype>
#include <deque>
#include <map>
#include <memory>
#include <mutex>
#include <set>
#include <string>
#include <thread>
#include <vector>

using Microsoft::WRL::ClassicCom;
using Microsoft::WRL::ComPtr;
using Microsoft::WRL::FtmBase;
using Microsoft::WRL::RuntimeClass;
using Microsoft::WRL::RuntimeClassFlags;

constexpr int kRate = 48000;
constexpr int kChannels = 2;
constexpr int kChunkFrames = kRate / 100;          // 10 ms
constexpr size_t kMaxBufferedFrames = kRate / 5;   // 200 ms: acima disso, descarta o mais antigo

static std::atomic<bool> g_running{true};

static void Log(const char* fmt, ...) {
  va_list args;
  va_start(args, fmt);
  vfprintf(stderr, fmt, args);
  va_end(args);
  fputc('\n', stderr);
  fflush(stderr);
}

static std::wstring Lower(std::wstring s) {
  std::transform(s.begin(), s.end(), s.begin(), [](wchar_t c) { return static_cast<wchar_t>(std::towlower(c)); });
  return s;
}

// ---------- processos ----------

struct ProcessInfo {
  DWORD parent;
  std::wstring exe;  // em minúsculas
};

static std::map<DWORD, ProcessInfo> SnapshotProcesses() {
  std::map<DWORD, ProcessInfo> result;
  HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (snap == INVALID_HANDLE_VALUE) return result;
  PROCESSENTRY32W entry = {sizeof(entry)};
  for (BOOL ok = Process32FirstW(snap, &entry); ok; ok = Process32NextW(snap, &entry)) {
    result[entry.th32ProcessID] = {entry.th32ParentProcessID, Lower(entry.szExeFile)};
  }
  CloseHandle(snap);
  return result;
}

static bool IsDescendantOf(DWORD pid, DWORD ancestor, const std::map<DWORD, ProcessInfo>& procs) {
  for (int depth = 0; pid != 0 && depth < 64; depth++) {
    if (pid == ancestor) return true;
    auto it = procs.find(pid);
    if (it == procs.end() || it->second.parent == pid) return false;
    pid = it->second.parent;
  }
  return false;
}

// ---------- uma captura por processo ----------

class Completion : public RuntimeClass<RuntimeClassFlags<ClassicCom>, FtmBase, IActivateAudioInterfaceCompletionHandler> {
 public:
  HANDLE done = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  HRESULT result = E_FAIL;
  ComPtr<IAudioClient> client;
  ~Completion() { CloseHandle(done); }
  STDMETHOD(ActivateCompleted)(IActivateAudioInterfaceAsyncOperation* op) override {
    ComPtr<IUnknown> unknown;
    HRESULT activateResult = E_FAIL;
    result = op->GetActivateResult(&activateResult, &unknown);
    if (SUCCEEDED(result)) result = activateResult;
    if (SUCCEEDED(result)) result = unknown.As(&client);
    SetEvent(done);
    return S_OK;
  }
};

class ProcessCapture {
 public:
  explicit ProcessCapture(DWORD pid) : pid_(pid) {}
  ~ProcessCapture() { Stop(); }

  bool Start() {
    thread_ = std::thread([this] { Run(); });
    WaitForSingleObject(started_, 5000);
    return ok_;
  }

  void Stop() {
    stop_ = true;
    if (thread_.joinable()) thread_.join();
  }

  /** Tira até `frames` quadros do buffer; devolve quantos havia. */
  size_t Pop(int16_t* out, size_t frames) {
    std::lock_guard<std::mutex> lock(mutex_);
    size_t n = std::min(frames, buffer_.size() / kChannels);
    for (size_t i = 0; i < n * kChannels; i++) {
      out[i] = buffer_.front();
      buffer_.pop_front();
    }
    return n;
  }

  DWORD pid() const { return pid_; }
  bool alive() const { return !failed_; }

 private:
  void Run() {
    CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    ok_ = Open();
    SetEvent(started_);
    if (ok_) Loop();
    client_.Reset();
    capture_.Reset();
    CoUninitialize();
  }

  bool Open() {
    AUDIOCLIENT_ACTIVATION_PARAMS params = {};
    params.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
    params.ProcessLoopbackParams.TargetProcessId = pid_;
    params.ProcessLoopbackParams.ProcessLoopbackMode = PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE;
    PROPVARIANT prop = {};
    prop.vt = VT_BLOB;
    prop.blob.cbSize = sizeof(params);
    prop.blob.pBlobData = reinterpret_cast<BYTE*>(&params);

    auto handler = Microsoft::WRL::Make<Completion>();
    ComPtr<IActivateAudioInterfaceAsyncOperation> op;
    HRESULT hr = ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, __uuidof(IAudioClient), &prop, handler.Get(), &op);
    if (FAILED(hr) || WaitForSingleObject(handler->done, 5000) != WAIT_OBJECT_0 || FAILED(handler->result)) {
      Log("erro: não foi possível capturar o processo %lu (0x%08lx)", pid_, FAILED(hr) ? hr : handler->result);
      return false;
    }
    client_ = handler->client;

    WAVEFORMATEX format = {};
    format.wFormatTag = WAVE_FORMAT_PCM;
    format.nChannels = kChannels;
    format.nSamplesPerSec = kRate;
    format.wBitsPerSample = 16;
    format.nBlockAlign = kChannels * 2;
    format.nAvgBytesPerSec = kRate * format.nBlockAlign;
    hr = client_->Initialize(AUDCLNT_SHAREMODE_SHARED,
                             AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM,
                             200000, 0, &format, nullptr);
    if (FAILED(hr)) {
      Log("erro: Initialize do processo %lu falhou (0x%08lx)", pid_, hr);
      return false;
    }
    ready_ = CreateEventW(nullptr, FALSE, FALSE, nullptr);
    client_->SetEventHandle(ready_);
    if (FAILED(client_->GetService(IID_PPV_ARGS(&capture_)))) return false;
    return SUCCEEDED(client_->Start());
  }

  void Loop() {
    while (!stop_ && g_running) {
      WaitForSingleObject(ready_, 100);
      UINT32 packet = 0;
      while (SUCCEEDED(capture_->GetNextPacketSize(&packet)) && packet > 0) {
        BYTE* data;
        UINT32 frames;
        DWORD flags;
        if (FAILED(capture_->GetBuffer(&data, &frames, &flags, nullptr, nullptr))) {
          failed_ = true;
          return;
        }
        {
          std::lock_guard<std::mutex> lock(mutex_);
          auto* samples = reinterpret_cast<int16_t*>(data);
          for (UINT32 i = 0; i < frames * kChannels; i++) {
            buffer_.push_back((flags & AUDCLNT_BUFFERFLAGS_SILENT) ? 0 : samples[i]);
          }
          while (buffer_.size() > kMaxBufferedFrames * kChannels) buffer_.pop_front();
        }
        capture_->ReleaseBuffer(frames);
      }
    }
    client_->Stop();
    CloseHandle(ready_);
  }

  DWORD pid_;
  std::thread thread_;
  HANDLE started_ = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  std::atomic<bool> stop_{false};
  std::atomic<bool> failed_{false};
  bool ok_ = false;
  ComPtr<IAudioClient> client_;
  ComPtr<IAudioCaptureClient> capture_;
  HANDLE ready_ = nullptr;
  std::mutex mutex_;
  std::deque<int16_t> buffer_;
};

// ---------- sessões de áudio ----------

struct Session {
  DWORD pid;
  bool active;
};

static std::vector<Session> ListSessions() {
  std::vector<Session> sessions;
  ComPtr<IMMDeviceEnumerator> enumerator;
  ComPtr<IMMDeviceCollection> devices;
  if (FAILED(CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, IID_PPV_ARGS(&enumerator)))) return sessions;
  if (FAILED(enumerator->EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE, &devices))) return sessions;
  UINT deviceCount = 0;
  devices->GetCount(&deviceCount);
  for (UINT d = 0; d < deviceCount; d++) {
    ComPtr<IMMDevice> device;
    ComPtr<IAudioSessionManager2> manager;
    ComPtr<IAudioSessionEnumerator> list;
    if (FAILED(devices->Item(d, &device))) continue;
    if (FAILED(device->Activate(__uuidof(IAudioSessionManager2), CLSCTX_ALL, nullptr, &manager))) continue;
    if (FAILED(manager->GetSessionEnumerator(&list))) continue;
    int count = 0;
    list->GetCount(&count);
    for (int i = 0; i < count; i++) {
      ComPtr<IAudioSessionControl> control;
      ComPtr<IAudioSessionControl2> control2;
      if (FAILED(list->GetSession(i, &control)) || FAILED(control.As(&control2))) continue;
      DWORD pid = 0;
      control2->GetProcessId(&pid);
      AudioSessionState state;
      control->GetState(&state);
      if (pid != 0 && state != AudioSessionStateExpired) sessions.push_back({pid, state == AudioSessionStateActive});
    }
  }
  return sessions;
}

// ---------- programa ----------

struct Options {
  std::wstring mode;
  HWND window = nullptr;
  DWORD parent = 0;
  std::set<std::wstring> blocked;  // nomes de .exe em minúsculas
};

static Options ParseArgs(int argc, wchar_t** argv) {
  Options o;
  if (argc >= 2) o.mode = argv[1];
  for (int i = 2; i + 1 < argc; i += 2) {
    std::wstring key = argv[i];
    std::wstring value = argv[i + 1];
    if (key == L"--window") o.window = reinterpret_cast<HWND>(static_cast<uintptr_t>(_wcstoui64(value.c_str(), nullptr, 10)));
    if (key == L"--parent") o.parent = wcstoul(value.c_str(), nullptr, 10);
    if (key == L"--block") {
      size_t start = 0;
      while (start <= value.size()) {
        size_t end = value.find(L',', start);
        std::wstring name = Lower(value.substr(start, end == std::wstring::npos ? std::wstring::npos : end - start));
        if (!name.empty()) o.blocked.insert(name);
        if (end == std::wstring::npos) break;
        start = end + 1;
      }
    }
  }
  return o;
}

/** Quais processos capturar agora. No modo "all", um processo cujo ancestral já entra fica de fora (a árvore já o inclui). */
static std::set<DWORD> PickTargets(const Options& o) {
  auto procs = SnapshotProcesses();
  auto blocked = [&](DWORD pid) {
    auto it = procs.find(pid);
    if (it == procs.end()) return true;
    if (o.blocked.count(it->second.exe)) return true;
    return o.parent != 0 && IsDescendantOf(pid, o.parent, procs);
  };

  std::set<DWORD> targets;
  if (o.mode == L"app") {
    DWORD pid = 0;
    if (o.window) GetWindowThreadProcessId(o.window, &pid);
    if (pid && !blocked(pid)) {
      targets.insert(pid);
    } else {
      Log("aviso: sem programa para capturar (janela %llu, processo %lu%s)", static_cast<unsigned long long>(reinterpret_cast<uintptr_t>(o.window)), pid,
          pid ? ", bloqueado" : "");
    }
    return targets;
  }

  std::vector<DWORD> candidates;
  for (const auto& s : ListSessions()) {
    if (!blocked(s.pid)) candidates.push_back(s.pid);
  }
  for (DWORD pid : candidates) {
    bool covered = false;
    for (DWORD other : candidates) {
      if (other != pid && IsDescendantOf(pid, other, procs)) covered = true;
    }
    if (!covered) targets.insert(pid);
  }
  return targets;
}

static void WatchParent(DWORD parent) {
  if (!parent) return;
  HANDLE h = OpenProcess(SYNCHRONIZE, FALSE, parent);
  if (!h) return;
  std::thread([h] {
    WaitForSingleObject(h, INFINITE);
    g_running = false;
  }).detach();
}

static int CommandSessions() {
  auto procs = SnapshotProcesses();
  for (const auto& s : ListSessions()) {
    auto it = procs.find(s.pid);
    wprintf(L"%lu\t%ls\t%ls\n", s.pid, it == procs.end() ? L"?" : it->second.exe.c_str(), s.active ? L"tocando" : L"parado");
  }
  return 0;
}

static int CommandCapture(const Options& o) {
  _setmode(_fileno(stdout), _O_BINARY);
  WatchParent(o.parent);
  timeBeginPeriod(1);

  std::map<DWORD, std::unique_ptr<ProcessCapture>> sources;
  auto refresh = [&] {
    auto targets = PickTargets(o);
    for (auto it = sources.begin(); it != sources.end();) {
      if (!targets.count(it->first) || !it->second->alive()) {
        Log("fonte: saiu %lu", it->first);
        it = sources.erase(it);
      } else {
        ++it;
      }
    }
    for (DWORD pid : targets) {
      if (sources.count(pid)) continue;
      auto capture = std::make_unique<ProcessCapture>(pid);
      if (capture->Start()) {
        Log("fonte: entrou %lu", pid);
        sources[pid] = std::move(capture);
      }
    }
  };
  refresh();

  LARGE_INTEGER freq, start, now;
  QueryPerformanceFrequency(&freq);
  QueryPerformanceCounter(&start);
  long long emitted = 0;
  ULONGLONG lastRefresh = GetTickCount64();
  std::vector<int16_t> chunk(kChunkFrames * kChannels);
  std::vector<int32_t> mix(kChunkFrames * kChannels);

  while (g_running) {
    Sleep(5);
    // No modo "all", programas começam e param de tocar: revisa a lista a cada segundo.
    if (o.mode == L"all" && GetTickCount64() - lastRefresh > 1000) {
      refresh();
      lastRefresh = GetTickCount64();
    }
    QueryPerformanceCounter(&now);
    long long due = (now.QuadPart - start.QuadPart) * kRate / freq.QuadPart - kChunkFrames * 3;  // 30 ms de folga
    while (emitted + kChunkFrames <= due) {
      std::fill(mix.begin(), mix.end(), 0);
      for (auto& [pid, source] : sources) {
        size_t got = source->Pop(chunk.data(), kChunkFrames);
        for (size_t i = 0; i < got * kChannels; i++) mix[i] += chunk[i];
      }
      for (size_t i = 0; i < mix.size(); i++) chunk[i] = static_cast<int16_t>(std::clamp(mix[i], -32768, 32767));
      if (fwrite(chunk.data(), sizeof(int16_t), chunk.size(), stdout) != chunk.size() || fflush(stdout) != 0) {
        g_running = false;  // o Aquarium fechou o cano
        break;
      }
      emitted += kChunkFrames;
    }
  }
  sources.clear();
  timeEndPeriod(1);
  return 0;
}

int wmain(int argc, wchar_t** argv) {
  CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  Options o = ParseArgs(argc, argv);
  if (o.mode == L"sessions") return CommandSessions();
  if (o.mode == L"app" || o.mode == L"all") return CommandCapture(o);
  fwprintf(stderr, L"uso: aquarium-audio sessions | app --window <hwnd> --parent <pid> [--block a.exe,b.exe] | all --parent <pid> [--block ...]\n");
  return 1;
}
