# DeBarrier changes

Each version's "- " lines become its release notes on GitHub.
Add a section here before bumping VERSION.

## 1.0.9

- Activity's column headings (Result, Site, Engine, Took, When) stand out as a heading bar, in every look

## 1.0.8

- Update now also replaces the window's own screens, so what you see matches the version that was installed (a new look no longer needs a hand-installed .spk). Install this version's .spk once by hand to turn it on
- If DSM won't let DeBarrier do that, Settings says so

## 1.0.7

- New look: Blades, with glossy silver blades you switch between with a click, ← → or a swipe. Pick it in Settings → Look
- The Box of X look is now called Xbox

## 1.0.6

- Update now installs by itself, with a progress bar and no Task Scheduler setup. The scheduled task is now optional, for installing updates while you're away
- If a new version won't start, DeBarrier goes back to the one that was installed

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
