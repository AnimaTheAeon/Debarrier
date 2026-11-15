# DeBarrier

DeBarrier gets [Materia](https://github.com/AnimaTheAeon/Materia)'s indexer searches through Cloudflare on a
Synology NAS. Materia sees it as a normal FlareSolverr at `http://your-nas:8191`. Behind that address
DeBarrier runs two engines in Container Manager and passes each request to the one you choose:

- **FlareSolverr** (`ghcr.io/flaresolverr/flaresolverr`)
- **Byparr** (`ghcr.io/thephaseless/byparr`), a drop-in replacement that gets through newer Cloudflare checks more often

If one can't get through a site, DeBarrier tries the other and remembers which engine works for that site.
POST requests and sessions always go to FlareSolverr, because Byparr only loads pages.

The window opens from the DSM main menu (administrators only) and uses the same FFVII menu and Box of X looks as
Materia and Jenova. It has three pages: Status (engines, Try a site, and the address for Materia), Activity and Settings.
Activity keeps only each site's host and path, never the query string, so passkeys aren't stored.

## Install (DSM 7.2.1 or newer, x86-64 such as the DS923+)

1. Package Center → Manual Install → `DeBarrier-<version>-x86_64.spk` → Next. It needs Container Manager and
   installs it if it's missing.
2. Container Manager downloads both engines as the project **debarrier**. That can take a few minutes the first time.
3. In Materia: Config → Proxies → Add proxy → FlareSolverr. Set Host to the address on DeBarrier's Status page,
   add a tag (for example `cloudflare`), then put the same tag on the indexers that need it.

Stop any FlareSolverr container you already run on port 8191 first, or pick another port in DeBarrier's Settings.
## Updates

DeBarrier checks this repo's GitHub Releases every 6 hours. Settings → Updates shows what's out, with **Check now**
and **Update now** buttons and an "install automatically" switch (on by default).

**Update now** works by itself: DeBarrier downloads the new version, checks it against GitHub's checksum and restarts on
it. If the new version won't start, it goes back to the one that was installed.

To also have DSM install updates while you're away (and refresh the Settings window itself), add one optional Task
Scheduler task: Control Panel → Task Scheduler → Create → Scheduled Task → User-defined script, User **root**, Daily with
Frequency **Every 5 minutes**, command `/var/packages/DeBarrier/target/bin/debarrier update`. The task does nothing
unless there's an update to install. It always asks GitHub itself, checks the download against GitHub's checksum, and
then installs it with `synopkg`. A failed automatic install isn't retried for 6 hours unless you press Update now.
DeBarrier shows these steps in Settings when "install automatically" is on and the task hasn't run.

Installing a new package (by the task or by hand) also pulls the newest FlareSolverr and Byparr images; Update now only swaps DeBarrier itself.

## How it fits together

- `bin/debarrier daemon` listens on the public port (8191) for `POST /v1`, `GET /health` and `GET /`, and on
  127.0.0.1:18191 for the DSM window.
- `ui/api.cgi` → `debarrier cgi` forwards the window's requests along with the DSM session. The service checks
  that session with DSM's `authenticate.cgi` and only lets administrators in.
- `conf/resource` uses DSM's **docker-project** worker (Container Manager 1432+, DSM 7.2.1+) to create, start and
  stop `compose/compose.yaml` with the package. The engines are published only on 127.0.0.1 (ports 8192 and 8193).
- Data (settings, history, log) lives in `/var/packages/DeBarrier/var`.

## Building

GitHub Actions builds the .spk on every push to `main`. To publish a release, add a section to `CHANGES.md`
(its "- " lines become the release notes), bump `VERSION`, and push.

Local build: `./build-spk.sh` (needs Go 1.22+) writes `dist/DeBarrier-<version>-x86_64.spk`.
`tools/make_icon.py` builds the icon from Materia's orb.

## License

GPL-3.0, the same as Materia. FlareSolverr (MIT) and Byparr (GPL-3.0) run unchanged from their own images.
Nunito and Orbitron fonts: SIL Open Font License (`ui/fonts/`).
