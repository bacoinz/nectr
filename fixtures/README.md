# Ficheiros de teste

`fixtures/real/` (fora do git) é para ficheiros teus, WAV ou MP3, usados para comparar
o medidor de loudness da app com o ffmpeg:

```
npm run loudness
```

Sem ficheiros lá, o teste gera um conjunto com o próprio ffmpeg (ruído rosa, tons com
mudanças de nível, um varrimento, picos entre amostras, clipping, um MP3). Precisa do
ffmpeg no PATH. Critério: integrado ±0,1 LU e true peak ±0,2 dB face ao `ebur128` do ffmpeg.
