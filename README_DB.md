## Adatbázis séma – Pénzügyi tracking alkalmazás

Ez a dokumentum a pénzügyi tracking alkalmazás alap adatmodelljét írja le (Better Auth felhasználókkal), a „zsebek” (pockets) és megosztások kezelésével együtt.

### Célok
- **Hitelesítés**: Better Auth + Drizzle adapter (PostgreSQL)
- **Alap zseb**: Minden új felhasználónak automatikusan létrejön egy HUF alapzseb.
- **Zsebek**: név, deviza (szabadszavas), tulajdonos (`owner_id`).
- **Megosztás**: tulajdonos megoszthat egy zsebet más felhasználóval; meghívás státusza: `pending` → `accepted`/`declined`.
- **Jogok**: csak `accepted` státusznál kap tényleges hozzáférést a meghívott.

### Táblák

1) `user` (Better Auth)
- Forrás: `packages/db/src/auth-schema.ts`
- Fontos mezők: `id`, `email`, `name`, `created_at`, `updated_at`, stb.

2) `pocket`
- Forrás: `packages/db/src/schema.ts`
- Mezők:
  - `id` (PK, serial)
  - `name` (text, kötelező)
  - `currency` (text, kötelező; pl. "HUF")
  - `owner_id` (text, FK → `user.id`, on delete cascade)
  - `created_at`, `updated_at`
- Indexek:
  - `pocket_owner_idx` az `owner_id`-re

3) `pocket_share`
- Forrás: `packages/db/src/schema.ts`
- Mezők:
  - `id` (PK, serial)
  - `pocket_id` (FK → `pocket.id`, on delete cascade)
  - `user_id` (FK → `user.id`, on delete cascade)
  - `status` (enum: `pending` | `accepted` | `declined`, default `pending`)
  - `created_at`, `updated_at`
- Indexek és egyediségek:
  - `pocket_share_pocket_user_unique` (`pocket_id`, `user_id`) – ugyanazt a felhasználót egy zsebre csak egyszer lehet meghívni
  - `pocket_share_pocket_idx`, `pocket_share_user_idx`

### Relációk és jogosultsági modell
- Egy `user` több `pocket` tulajdonosa lehet.
- Megosztáskor a `pocket_share` rekord jelzi, hogy egy `user` meghívást kapott egy `pocket`-hez.
- A meghívott csak akkor fér hozzá (olvashat/szerkeszthet), ha a `status = 'accepted'`.
- `pending` alatt sem listázásban, sem tartalomban nem jelenik meg a zseb a meghívottnak (ez UI/API rétegben érvényesítendő: szűrés `status = 'accepted'`).

### Alap zseb létrehozása regisztrációnál
- Helye: `src/lib/auth.ts`
- Megoldás: Better Auth `databaseHooks.user.create.after` hook.
- Művelet: új felhasználó létrejötte után beszúr egy rekordot a `pocket` táblába:
  - `name = "Alap zseb"`, `currency = "HUF"`, `owner_id = user.id`.
- Hiba esetén logolunk; az auth folyamatot nem blokkoljuk.

### Jövőbeli bővítések
- Meghívások kezelése (meghívó e-mail, értesítés UI-ban, elfogadás/elutasítás endpointok).
- Zsebhez műveleti log/napló, szerepkörök (pl. csak olvasás), deviza normalizálása (ISO 4217), multi-currency támogatás.
- `pocket` név egyedisége tulajdonoson belül opcionálisan bevezethető.

### Migráció
- Generálás: `drizzle-kit generate` a `drizzle.config.ts` alapján.
- Push: `drizzle-kit push` a futó adatbázisra.

Lásd még: `docs/architecture.md`, `docs/endpoints-pockets.md`.

### Megjegyzések
- A `user` táblát a Better Auth kezeli; a domain táblák (`pocket`, `pocket_share`) a saját sémában vannak.
- A `pocket_share.status` a hozzáférés kapuőre. API rétegben minden listázó/olvasó/szerkesztő végpontnál ellenőrizni kell.


