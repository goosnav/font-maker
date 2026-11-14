Goosnav Font — development preview

Extract the entire folder, then open the launcher matching your system:
  macOS: Open Goosnav Font — macOS.app
  Windows: Open Goosnav Font — Windows x64.exe or Windows ARM64.exe
  Linux: Open Goosnav Font — Linux x86_64.AppImage or Linux ARM64.AppImage

Keep app/ beside the launchers. First launch needs internet access to download
managed Python. No Python, Node, or compiler installation is required from you.

These are unsigned preview launchers. macOS or Windows may show a trust prompt.
Linux may require marking the AppImage executable in its file properties.

Verification: browser workflows were exercised in Chrome, Firefox, and
Playwright WebKit on Apple Silicon macOS. The native Apple Silicon launcher
passed concurrent launch, repeat launch, project recovery, and Quit checks.
Drawing, reference overlays, and Test font also passed in native Safari.
Windows, Linux, Intel Mac, physical print-and-scan trials, and physical pen
devices are not yet acceptance-tested.
This preview is not an accepted M1a release.

User data and logs:
  macOS: ~/Library/Application Support/Goosnav Font/
  Windows: %LOCALAPPDATA%\Goosnav Font\
  Linux: ${XDG_DATA_HOME:-~/.local/share}/Goosnav Font/

On setup failure, use Retry after resolving the displayed error. Keep the log
and diagnostic code. Reopening the launcher reuses a healthy running instance.
Use File > Quit to stop the local application. Save project files for backups.
