; Fecha o módulo de áudio antes de copiar ou apagar arquivos: um .exe aberto trava o instalador.
; O app já encerra o processo antes de atualizar; isto cobre o caso de ele ter ficado para trás.
!macro customInit
  nsExec::Exec '"$SYSDIR\taskkill.exe" /F /IM aquarium-audio.exe'
  Pop $0
!macroend

!macro customUnInit
  nsExec::Exec '"$SYSDIR\taskkill.exe" /F /IM aquarium-audio.exe'
  Pop $0
!macroend
