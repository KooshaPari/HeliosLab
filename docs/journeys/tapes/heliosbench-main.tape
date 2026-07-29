Output docs/journeys/recordings/heliosbench-main.gif
Output docs/journeys/recordings/heliosbench-main.mp4

Set Shell "powershell"
Set FontSize 18
Set Width 1200
Set Height 700
Set TypingSpeed 10ms

Type "uv run --offline helios-bench tasks --category code_completion; Write-Output ('__EXIT_' + $LASTEXITCODE + '__')"
Enter
Sleep 18s
