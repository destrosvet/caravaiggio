# Caravaiggio

Caravaiggio je připravovaný software pro převod rastrového obrazu na fyzickou malbu prováděnou štětcovým XY/XYZ plotterem. Aplikace připraví omezenou paletu, naplánuje tahy, nasimuluje výsledek a pomocí postprocesoru vytvoří standardní G-code pro GRBL nebo jiný řídicí systém.

Hlavní a průběžně aktualizované zadání je v dokumentu [PROJECT_SPEC.md](PROJECT_SPEC.md).

Aktuální stav: M1 má sestavitelnou desktopovou aplikaci a M2 obsahuje editor fyzické palety a první OKLab posterizaci. Podrobnosti jsou v [docs/M0.md](docs/M0.md), [docs/M1.md](docs/M1.md) a [docs/M2.md](docs/M2.md).

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
