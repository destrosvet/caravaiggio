# Caravaiggio

Caravaiggio je připravovaný software pro převod rastrového obrazu na fyzickou malbu prováděnou štětcovým XY/XYZ plotterem. Aplikace připraví omezenou paletu, naplánuje tahy, nasimuluje výsledek a pomocí postprocesoru vytvoří standardní G-code pro GRBL nebo jiný řídicí systém.

Hlavní a průběžně aktualizované zadání je v dokumentu [PROJECT_SPEC.md](PROJECT_SPEC.md).

Aktuální stav: aplikace obsahuje přípravu obrazu a palety, generování tahů, editor pracoviště, simulaci a export GRBL XYZ. Nádobky a otírací zóna mají nastavitelné servisní sekvence; simulace i export používají stejné dráhy stroje. Nastavení a omezení popisuje [docs/M6.md](docs/M6.md).

## Spuštění

Webová vývojová verze:

```powershell
npm.cmd run dev
```

Desktopová verze po instalaci Rustu a Visual Studio Build Tools s workloadem **Desktop development with C++**:

```powershell
npm.cmd run desktop:dev
```

Windows NSIS instalátor se sestaví příkazem `npm.cmd run desktop:build`.

Optional local AI posterization with the preserved classical option: [SAM 3 setup and workflow](docs/SAM3.md).
