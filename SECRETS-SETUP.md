# Updater signing key & GitHub secrets — SOLFALL Launcher

**English** · [Español](#español)

The launcher only installs updates signed with **your** private key. The matching **public** key is compiled into
every launcher. Only Voiden (the repo owner) generates and keeps the private key. **Never put a private key (or its
password) in the repo, an issue, a chat or a report.** We only need the `.pub` file.

> ⚠ **If the private key or its password is lost, launchers already installed can never be updated again** (users
> would have to reinstall by hand). Back up both before the first release.

## 1. Generate the key pair (Windows, once)
In PowerShell or `cmd`, with Node.js installed:
```bat
npx @tauri-apps/cli signer generate -w %USERPROFILE%\.tauri\solfall.key
```
- Type a **strong password** when asked (do not leave it empty) and store it in your password manager.
- This writes two files:
  - `%USERPROFILE%\.tauri\solfall.key` — **PRIVATE**. Never share it.
  - `%USERPROFILE%\.tauri\solfall.key.pub` — public. This is the only file you send us.

## 2. Back up (before anything else)
- Copy `solfall.key` to **offline** storage (e.g. an encrypted USB drive kept at home) and, ideally, a second place.
- Store the **password** separately (password manager). The key is useless without it — and you can't sign without both.

## 3. Add the GitHub secrets (primary path: web UI)
Repo `CrystalFVPM-DEV/SOLFALL-Launcher-by-CrystalFVPM` → **Settings → Secrets and variables → Actions → New repository secret**:

| Name | Value |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | the **contents** of `solfall.key` (open it in Notepad, copy everything, paste) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | the password from step 1 |

**Alternative (GitHub CLI):**
```bat
gh secret set TAURI_SIGNING_PRIVATE_KEY --repo CrystalFVPM-DEV/SOLFALL-Launcher-by-CrystalFVPM < %USERPROFILE%\.tauri\solfall.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --repo CrystalFVPM-DEV/SOLFALL-Launcher-by-CrystalFVPM
```
(The second command prompts for the value, so the password never lands in your shell history.)

## 4. Enable immutable releases (before the first tag)
Repo → **Settings → General → Releases → "Enable release immutability"** (tick it, save). Published releases then can't
have their assets swapped. The release workflow creates a **draft**, uploads `.exe` + `.sig` + `latest.json`, checks
them and only then publishes.

**Never publish a release as "latest" without `latest.json`** — installed launchers read
`/releases/latest/download/latest.json`; a latest release without it means *nobody* gets updates until it's fixed.

## 5. Send us only the public key
Send the **contents of `solfall.key.pub`** (one line of base64, it starts with `dW50cnVzdGVk…`). We put it in the single
place it lives (`src-tauri/tauri.conf.json → plugins.updater.pubkey`) with
```bat
npm run set-pubkey -- %USERPROFILE%\.tauri\solfall.key.pub
```
and rebuild. Until then the repo carries the **TEST-ONLY** public key and the release workflow refuses to run (by design).

---

## Español

El launcher solo instala actualizaciones firmadas con **tu** clave privada. La clave **pública** correspondiente va
compilada dentro de cada launcher. Solo Voiden (dueño del repo) genera y guarda la privada. **Nunca pongas una clave
privada (ni su contraseña) en el repo, un issue, un chat o un informe.** A nosotros solo nos hace falta el `.pub`.

> ⚠ **Si se pierde la clave privada o su contraseña, los launchers ya instalados no podrán actualizarse nunca más**
> (habría que reinstalar a mano). Respalda ambas antes del primer release.

## 1. Generar el par de claves (Windows, una vez)
En PowerShell o `cmd`, con Node.js instalado:
```bat
npx @tauri-apps/cli signer generate -w %USERPROFILE%\.tauri\solfall.key
```
- Escribe una **contraseña fuerte** cuando la pida (no la dejes vacía) y guárdala en tu gestor de contraseñas.
- Se crean dos archivos:
  - `%USERPROFILE%\.tauri\solfall.key` — **PRIVADA**. No se comparte nunca.
  - `%USERPROFILE%\.tauri\solfall.key.pub` — pública. Es el único archivo que nos envías.

## 2. Respaldo (antes que nada)
- Copia `solfall.key` a un almacenamiento **offline** (p. ej. un USB cifrado guardado en casa) y, mejor, a un segundo lugar.
- Guarda la **contraseña** por separado (gestor de contraseñas). Sin ella la clave no sirve, y sin las dos no se puede firmar.

## 3. Cargar los secrets de GitHub (camino principal: web)
Repo `CrystalFVPM-DEV/SOLFALL-Launcher-by-CrystalFVPM` → **Settings → Secrets and variables → Actions → New repository secret**:

| Nombre | Valor |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | el **contenido** de `solfall.key` (ábrelo con el Bloc de notas, copia todo, pega) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | la contraseña del paso 1 |

**Alternativa (GitHub CLI):**
```bat
gh secret set TAURI_SIGNING_PRIVATE_KEY --repo CrystalFVPM-DEV/SOLFALL-Launcher-by-CrystalFVPM < %USERPROFILE%\.tauri\solfall.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --repo CrystalFVPM-DEV/SOLFALL-Launcher-by-CrystalFVPM
```
(El segundo comando pide el valor, así la contraseña no queda en el historial de la consola.)

## 4. Activar releases inmutables (antes del primer tag)
Repo → **Settings → General → Releases → «Enable release immutability»** (marcar y guardar). Así nadie puede cambiar
los archivos de un release ya publicado. El workflow crea el release como **borrador**, sube `.exe` + `.sig` +
`latest.json`, los verifica y recién entonces lo publica.

**Nunca publiques un release como «latest» sin `latest.json`**: los launchers instalados leen
`/releases/latest/download/latest.json`; un latest sin ese archivo deja a *todos* sin updates hasta arreglarlo.

## 5. Envíanos solo la clave pública
Envía el **contenido de `solfall.key.pub`** (una línea en base64 que empieza por `dW50cnVzdGVk…`). Nosotros la ponemos
en el único lugar donde vive (`src-tauri/tauri.conf.json → plugins.updater.pubkey`) con
```bat
npm run set-pubkey -- %USERPROFILE%\.tauri\solfall.key.pub
```
y recompilamos. Mientras tanto el repo lleva la clave pública **TEST-ONLY** y el workflow de release se niega a
ejecutarse (a propósito).
