# DeBarrier changes

Each version's "- " lines become its release notes on GitHub.
Add a section here before bumping VERSION.

## 1.0.5

- Fixed: FlareSolverr still stopping on start ("Permission denied: '/app/chromedriver'"). It now runs from its own writable copy, whichever user Container Manager starts it as

## 1.0.4

- Settings no longer says "Installing…" while the update task hasn't been set up; it says the update is waiting for the task
- Shows when an install is taking too long

## 1.0.3

- Fixed: FlareSolverr kept stopping and restarting ("Permission denied: '/.local'"). Both engines now get a home folder they can write to

## 1.0.2

- Updates: DeBarrier checks GitHub every 6 hours and installs new versions by itself (turn this off in Settings → Updates)
- Update now button in Settings → Updates
- One-time setup: a Task Scheduler task, shown step by step in Settings

## 1.0.1

- New icon: red, green and blue

## 1.0.0

- First release: FlareSolverr and Byparr behind one FlareSolverr address for Materia, with fallback between them
