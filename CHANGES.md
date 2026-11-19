# DeBarrier changes

Each version's "- " lines become its release notes on GitHub.
Add a section here before bumping VERSION.

## 1.0.18

- Fixed: in MC360, pointing at a blade or a menu entry could fill it with a solid blue block, and the menu text came out heavy and bold. The look no longer picks up the app's own button and text styles.
- Fixed: on a page, MC360 now keeps the open blade fully on screen at the left, with the page beside it and the other blades showing at the right, instead of cutting the blade off at the window's edge.

## 1.0.17

- MC360 now always opens on the menu of the blade you're on (switching looks used to drop you straight onto the page, with the blades parted off the screen until you clicked the blade's edge). It also fits tall or narrow windows: it scales to the window's width as well as its height and centres itself, and it re-checks the size whenever it draws.
- The window's new screens need this version's .spk installed (Package Center > Manual Install, or the scheduled update task).

## 1.0.16

- New look: MC360. The blades from the MC360 dashboard skin, one per page (Status, Activity, Settings, Log), each with a menu of what that page holds. Pick an entry and the page opens on the blade and jumps to that part of it, with every button it has in the other looks. Left and Right change blades, Up and Down move, Enter opens, Esc goes back. Three skins (Default, Glass, Carbon), the skin's sounds with a volume control, and Calmer motion for a still background. Press G or the Y button for the guide: look, skin, sounds and updates. Pick it under Settings > Look.
- The window's new screens need this version's .spk installed (Package Center > Manual Install, or the scheduled update task).

## 1.0.15

- The Liquid Glass look is now called Dark Glass. Nothing else changes: if you were using it, you still are.

## 1.0.14

- Picking a second theme while the first was still saving no longer flips back to the first one for a moment.

## 1.0.13

- Xbox theme: every page now has the page bar along the bottom, one tab per page, next to Back. It is hidden on the home screen.
- Xbox theme: opening a page from the orb now fades through a dark green veil instead of a bright flash.

## 1.0.12

- Package Center no longer shows developer or support web links; the developer is shown as DeBarrier.

## 1.0.11

- Check now: messages say "update server" and never include a web address.
- The "what's new" link is now a What's new section that shows the notes on the page.
- "Install updates automatically" no longer names where updates come from.

## 1.0.10

- New look: Dark Glass. Dark frosted glass, capsule buttons and fields, switches instead of check boxes, and a menu pill that glides between pages. Pick it in Settings → Look. The other three looks are unchanged.

## 1.0.9

- Activity's column headings (Result, Site, Engine, Took, When) stand out as a heading bar, in every look

## 1.0.8

- Update now also replaces the window's own screens, so what you see matches the version that was installed (a new look no longer needs a hand-installed .spk). Install this version's .spk once by hand to turn it on
- If DSM won't let DeBarrier do that, Settings says so

## 1.0.7

- New look: Blades, with glossy silver blades you switch between with a click, ← → or a swipe. Pick it in Settings → Look
- The Xbox look is now called Xbox

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
