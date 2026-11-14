# Familiebudget – app til mobil og PC

Budget, månedlig afstemning, besparelser og forsikringstilbud. Appen kører på GitHub Pages, kan installeres som app med eget ikon og virker også offline. Data deles mellem enheder via en **privat** fil på GitHub.

## Det skal du bruge

| Repo | Synlighed | Indhold |
|---|---|---|
| `familiebudget` | Offentligt (GitHub Pages) | Appens filer – **ingen tal** |
| `familiebudget-data` | **Privat** | `budget-data.json` med jeres budget |

Budgettallene ligger aldrig i det offentlige repo.

## 1 · Læg appen på GitHub Pages

Som med surdejsappen:

1. Opret repoet: https://github.com/new?name=familiebudget&visibility=public (sæt flueben i *Add a README file*) → **Create repository**.
2. Upload: https://github.com/henrikfriisthuesen-bit/familiebudget/upload/main → træk alle 10 filer fra mappen `familiebudget` ind → **Commit changes**.
3. Slå Pages til: https://github.com/henrikfriisthuesen-bit/familiebudget/settings/pages → *Deploy from a branch* → *main* / *(root)* → **Save**.
4. Efter 1–2 minutter ligger appen på https://henrikfriisthuesen-bit.github.io/familiebudget/

## 2 · Opret det private data-repo

1. Opret repoet: https://github.com/new?name=familiebudget-data&visibility=private (sæt flueben i *Add a README file*).
2. Upload `budget-data.json` fra mappen `PRIVAT - upload til familiebudget-data`: https://github.com/henrikfriisthuesen-bit/familiebudget-data/upload/main. Filen indeholder budget 2026 med januar–november afstemt.

## 3 · Lav en adgangsnøgle (token)

1. GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. *Repository access*: **Only select repositories** → vælg `familiebudget-data`.
3. *Permissions → Repository permissions → Contents*: **Read and write**.
4. Vælg en udløbsdato (fx 1 år) og kopiér nøglen.

## 4 · Forbind appen

Åbn appen, tryk **☁︎ Synk** øverst, og udfyld brugernavnet `henrikfriisthuesen-bit`, `familiebudget-data`, `main`, `budget-data.json` og nøglen. Tryk **Gem og synk**. Gør det samme på hver enhed (PC, din mobil, Majbrits mobil).

Ændringer gemmes med det samme på enheden og sendes til GitHub efter få sekunder. Andre enheder henter dem, når appen åbnes, og ellers hvert minut. Er I offline, sendes ændringerne, når der er net igen.

## 5 · Installér som app

- **iPhone/iPad (Safari):** Del-knappen → **Føj til hjemmeskærm**.
- **Android (Chrome):** menuen ⋮ → **Installer app** / **Føj til startskærm**.
- **PC/Mac (Chrome eller Edge):** installer-ikonet i adresselinjen → **Installer**.

## Opdatering af appen

Upload de nye filer til `familiebudget` (de gamle overskrives). Ret samtidig `VERSION` i `sw.js` (fx `familiebudget-v2`), så alle enheder henter den nye version. Jeres data påvirkes ikke.

## Sikkerhedskopi

Under **Budget → Sikkerhedskopi** kan I downloade én fil med alt og gendanne den igen. Den kan også flytte data fra Claude-versionen af appen. Data-repoet på GitHub gemmer desuden automatisk historik over alle ændringer.
