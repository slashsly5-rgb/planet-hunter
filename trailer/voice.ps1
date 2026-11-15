# Speaks each line of the trailer script to its own WAV file with the voice built into Windows.
# usage: powershell -File voice.ps1 <out-dir> <rate -10..10>
param([string]$Out, [int]$Rate = 2)
Add-Type -AssemblyName System.Speech
$lines = @(
  "Planet Hunter. From the Milky Way, dive to our Solar System.",
  "Every world is at its real position. Click anything.",
  "In the Hunt, detect what moves in real Sphere X images, predict it, then classify it.",
  "Explore each world in three colours, as a time lapse, and as a three D time stack.",
  "Run a computer scan, compare six months apart, and measure it yourself.",
  "The Planet X lab shows why it hides.",
  "Then fly the Voyage. Dodge, shoot, scan ten real worlds, and stack images to find Planet X.",
  "In English and Malay, on computer or phone, with a classroom sheet."
)
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voices = $s.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name }
Write-Output ("voices: " + ($voices -join ", "))
foreach ($want in @("Microsoft David Desktop", "Microsoft Mark", "Microsoft George Desktop")) { if ($voices -contains $want) { $s.SelectVoice($want); break } }
Write-Output ("using: " + $s.Voice.Name)
$s.Rate = $Rate
for ($i = 0; $i -lt $lines.Count; $i++) {
  $s.SetOutputToWaveFile((Join-Path $Out ("vo$i.wav")))
  $s.Speak($lines[$i])
}
$s.SetOutputToNull(); $s.Dispose()
