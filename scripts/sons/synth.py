"""Gera por síntese os efeitos sonoros do app e grava WAVs mono 48 kHz, com volume percebido igualado.

Os arquivos em src/renderer/src/assets/sons foram gerados com:
    python scripts/sons/synth.py src/renderer/src/assets/sons -2 -16
(precisa de numpy). Argumentos: pasta de saída, transposição em semitons, volume-alvo em dB.
"""
import os, sys, wave
import numpy as np

SR = 48000
OUT = sys.argv[1]
SEMITONES = float(sys.argv[2]) if len(sys.argv) > 2 else 0.0  # transposição de todas as notas
TARGET_DB = float(sys.argv[3]) if len(sys.argv) > 3 else -20.0  # RMS máximo em janela de 50 ms
PITCH = 2 ** (SEMITONES / 12)


def t_axis(dur):
    return np.arange(int(dur * SR)) / SR


def tone(freq, dur, attack=0.004, tau=0.05, release=0.01, glide_to=None, glide_time=None, partials=((1, 1.0),), vibrato=0.0):
    """Senoide com ataque linear, decaimento exponencial e release; glide opcional (exponencial)."""
    t = t_axis(dur)
    freq *= PITCH
    glide_to = glide_to and glide_to * PITCH
    if glide_to:
        gt = glide_time or dur
        k = np.clip(t / gt, 0, 1)
        f = freq * (glide_to / freq) ** k
    else:
        f = np.full_like(t, freq)
    if vibrato:
        f = f * (1 + vibrato * np.sin(2 * np.pi * 7 * t))
    phase = 2 * np.pi * np.cumsum(f) / SR
    sig = sum(a * np.sin(n * phase) for n, a in partials)
    env = np.exp(-t / tau)
    env *= np.clip(t / attack, 0, 1)
    rel = int(release * SR)
    if rel:
        env[-rel:] *= np.linspace(1, 0, rel)
    return sig * env


def noise_tick(dur=0.012, center=6000, tau=0.003):
    """Transiente curto de ruído filtrado, para o 'tic' de ataque de sinos."""
    t = t_axis(dur)
    rng = np.random.default_rng(7)
    n = rng.standard_normal(len(t))
    # passa-faixa simples: diferença de duas médias móveis
    k1 = max(1, int(SR / center / 2))
    k2 = max(2, int(SR / center))
    n = np.convolve(n, np.ones(k1) / k1, 'same') - np.convolve(n, np.ones(k2) / k2, 'same')
    return n * np.exp(-t / tau)


def place(total, *items):
    out = np.zeros(int(total * SR))
    for start, sig, gain in items:
        i = int(start * SR)
        seg = sig[: len(out) - i]
        out[i : i + len(seg)] += gain * seg
    return out


def echo(sig, delay, gain, times=1):
    out = np.concatenate([sig, np.zeros(int(delay * times * SR) + 1)])
    for k in range(1, times + 1):
        d = int(delay * k * SR)
        out[d : d + len(sig)] += sig * gain**k
    return out


def finish(sig, fade=0.015):
    # corta o silêncio do fim, aplica fade e normaliza pelo volume percebido
    thr = 10 ** (-60 / 20) * np.abs(sig).max()
    last = np.where(np.abs(sig) > thr)[0][-1]
    sig = sig[: last + 1].copy()
    f = int(fade * SR)
    sig[-f:] *= np.linspace(1, 0, f) ** 2
    w = int(0.05 * SR)
    loud = np.sqrt(np.convolve(sig**2, np.ones(w) / w, 'valid').max())
    sig *= 10 ** (TARGET_DB / 20) / loud
    peak = np.abs(sig).max()
    if peak > 0.89:  # -1 dBFS de margem
        sig *= 0.89 / peak
    return sig


def write(name, sig):
    data = (np.clip(sig, -1, 1) * 32767).astype('<i2')
    with wave.open(os.path.join(OUT, name + '.wav'), 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data.tobytes())


# --- receitas ---------------------------------------------------------------

def swell(freq, dur, attack, release, glide_to=None, glide_time=None):
    """Nota que cresce devagar e corta rápido (a "bolha")."""
    return tone(freq, dur, attack=attack, tau=10.0, release=release, glide_to=glide_to, glide_time=glide_time)


def stream_start(up=True):
    # StartHearing: 1000 Hz → 2000 Hz, senoides puras; a segunda é curta e tem um eco discreto.
    a, b = (1004, 2004) if up else (2004, 1004)
    n1 = tone(a, 0.058, tau=0.045, release=0.012)
    n2 = tone(b, 0.04, tau=0.025, release=0.012)
    n2 = echo(n2, 0.04, 0.13, times=2)
    return place(0.3, (0, n1, 1.0), (0.088, n2, 1.0))


def room_join(up=True):
    # ChatOpening: bolha curta (383→463 Hz) e bolha que cresce (650→800 Hz); a bolha que cresce repete a 140 ms.
    f1, g1, f2, g2 = (383, 463, 650, 800) if up else (800, 650, 463, 383)
    b1 = tone(f1, 0.05, attack=0.01, tau=0.022, glide_to=g1, release=0.008)
    b2 = swell(f2, 0.06, attack=0.035, release=0.012, glide_to=g2, glide_time=0.03)
    return place(0.26, (0, b1, 1.5), (0.055, b2, 1.0), (0.13, b1, 0.06), (0.145, b2, 0.18))


def watcher():
    # MidiaCommands: 1600 Hz, depois 2117 Hz (quarta acima) que cresce e corta, cauda curta e eco a 190 ms.
    n1 = tone(1600, 0.05, tau=0.06, release=0.01, vibrato=0.006)
    rise = swell(2117, 0.06, attack=0.04, release=0.008) + 0.3 * swell(1592, 0.06, attack=0.04, release=0.008)
    tail = tone(2117, 0.12, attack=0.008, tau=0.035, release=0.02) + 0.35 * tone(1592, 0.12, attack=0.008, tau=0.04, release=0.02)
    return place(0.4, (0, n1, 1.0), (0.058, rise, 1.0), (0.125, tail, 0.35), (0.228, rise, 0.14), (0.29, tail, 0.06))


def error():
    # Error: dois toques de 796 Hz a 45 ms; cauda com uma segunda onda que volta em ~200 ms.
    hit1 = tone(796, 0.04, tau=0.03, release=0.012)
    ring = tone(796, 0.3, attack=0.006, tau=0.045, release=0.03)
    swell2 = tone(796, 0.36, attack=0.07, tau=0.07, release=0.05)
    return place(0.55, (0, hit1, 1.0), (0.04, ring, 0.9), (0.12, swell2, 0.32))


def reconnect(up=True):
    # SearchingInternet: dois "pings" de sino (2204 → 4942 Hz) com tic de ataque.
    a, b = (2204, 4942) if up else (4942, 2204)
    p1 = tone(a, 0.07, attack=0.002, tau=0.01, release=0.01, partials=((1, 1.0), (2.4, 0.18), (3.0, 0.22)))
    p1 += tone(a, 0.07, attack=0.002, tau=0.03, release=0.01) * 0.25
    p2 = tone(b, 0.08, attack=0.002, tau=0.015, release=0.01, partials=((1, 1.0), (0.76, 0.12)))
    return place(0.2, (0, p1, 1.0), (0, noise_tick(), 0.25), (0.11, p2, 0.9), (0.11, noise_tick(), 0.2))


RECIPES = {
    'transmissao-comecou': stream_start(True),
    'transmissao-terminou': stream_start(False),
    'entrou-na-sala': room_join(True),
    'saiu-da-sala': room_join(False),
    'comecou-a-assistir-voce': watcher(),
    'conexao-caiu': error(),
    'conexao-voltou': reconnect(True),
}

if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for name, sig in RECIPES.items():
        write(name, finish(sig))
        print(name)
