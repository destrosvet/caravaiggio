# Caravaiggio – projektové zadání a plán

Verze dokumentu: 0.1  
Datum: 8. října 2026  
Stav: úvodní návrh, otevřený k upřesnění

## 1. Vize projektu

Caravaiggio je desktopová aplikace s grafickým rozhraním, která převede vstupní rastrový obrázek na fyzickou malbu vytvořenou automatickým štětcovým plotterem.

Software má pokrývat celý proces od přípravy obrazu po G-code:

1. načtení a úpravu zdrojového obrázku,
2. redukci obrazu na dostupnou fyzickou paletu,
3. volitelnou přípravu směsí nebo optického míchání,
4. generování tahů štětce,
5. plánování nabírání barvy, oplachování a otírání,
6. simulaci provedení a výsledného vzhledu,
7. validaci pohybů stroje,
8. export standardního G-code pomocí konfigurovatelného postprocesoru.

Hardware zatím není součástí implementace. Software však musí používat dostatečně obecný model, aby šel později připojit k plotteru řízenému například GRBL.

## 2. Hlavní principy

- Malířská logika nesmí být zakódována přímo v G-code.
- Analýza obrazu vytvoří nezávislý „malířský plán“ neboli seznam sémantických operací.
- Stejný malířský plán používá simulátor i G-code postprocesor.
- Souřadnice obrazu, souřadnice plátna a strojové souřadnice musí být oddělené a převáděné explicitní transformací.
- Každý export musí být předem validován proti pracovním limitům, zakázaným zónám a konfiguraci nástroje.
- Projektový soubor musí být reprodukovatelný: musí obsahovat vstup, nastavení, paletu, plán tahů a verzi algoritmu.
- Fyzické vlastnosti barev se nesmí zaměňovat s RGB mícháním na monitoru.

## 3. Rozsah první verze

První použitelná verze bude podporovat:

- import PNG a JPEG,
- ořez, otočení a změnu měřítka,
- zadání fyzického rozměru malby v milimetrech,
- až osm uživatelem definovaných základních barev,
- automatickou posterizaci a ruční změnu přiřazení barev,
- režim bez fyzického míchání pigmentů,
- rozdělení barevných ploch na jednoduché rovnoběžné tahy,
- nastavitelnou šířku štětce a překrytí tahů,
- model úbytku barvy během tahu,
- plánování opětovného namočení, opláchnutí a otření,
- definici geometrie plátna, vaniček, vody a bezpečných oblastí,
- 2D animovanou simulaci celého procesu,
- zobrazení trajektorie a odhad doby provedení,
- export standardního G-code pro výchozí profil GRBL,
- uložení a opětovné otevření projektu.

První verze nebude garantovat:

- fyzikálně přesnou simulaci pigmentů,
- automatické míchání libovolných barev ve vaničce,
- realistické rozpíjení mokré barvy,
- kamerovou zpětnou vazbu,
- automatickou kalibraci stroje,
- přímé streamování G-code do řídicí desky,
- generování reliéfu nebo plnohodnotnou 3D simulaci štětce.

## 4. Uživatelský pracovní postup

### 4.1 Nový projekt

Uživatel zvolí zdrojový obrázek, cílový formát, orientaci a rozlišení pracovního náhledu. Aplikace zachová originál a všechny další kroky budou nedestruktivní.

### 4.2 Příprava obrazu

Uživatel nastaví ořez, jas, kontrast, saturaci a případné vyhlazení. Samostatná volba určí minimální velikost barevné oblasti, aby nevznikaly neproveditelné drobné ostrůvky.

### 4.3 Paleta a posterizace

Aplikace přiřadí pixely k dostupným fyzickým barvám. Barevná vzdálenost se bude vyhodnocovat v perceptuálním prostoru OKLab nebo Lab, nikoliv pouze jako vzdálenost RGB.

Uživatel může:

- změnit počet použitých barev,
- zamknout konkrétní barvu,
- sloučit dvě výsledné barvy,
- přemapovat oblast na jinou barvu,
- upravit citlivost posterizace a vyhlazení hran,
- prohlížet rozdíl mezi originálem a redukovaným obrazem.

### 4.4 Strategie malby

Uživatel zvolí parametry štětce a strategii tahů. Pro první verzi budou podporované rovnoběžné výplňové tahy. Architektura má později umožnit konturové tahy, křížové šrafování, tečkování a tahy řízené lokální orientací obrazu.

### 4.5 Pracovní prostor stroje

Editor pracovního prostoru umožní umístit:

- plátno nebo papír,
- jednotlivé nádoby s barvami,
- nádobu s vodou,
- místo pro otření štětce,
- parkovací pozici,
- zakázané a bezpečné přejezdové zóny.

Všechny rozměry a pozice budou v milimetrech.

### 4.6 Simulace a kontrola

Uživatel spustí animovanou simulaci. Bude možné zobrazit výsledný obraz, barevné vrstvy, stopu štětce, přejezdy, namáčení, čištění a časovou osu operací. Simulace musí používat stejný malířský plán, který bude exportován.

### 4.7 Export

Po úspěšné validaci uživatel vybere profil stroje a exportuje `.gcode`. Součástí výsledku bude přehled varování, odhad času, počet tahů, počet namočení a předpokládaná délka pohybu.

## 5. Zpracovatelská pipeline

```text
Vstupní obraz
  -> normalizace a ořez
  -> perceptuální redukce barev
  -> mapa materiálů / receptů
  -> čištění a vektorizace oblastí
  -> generování kandidátních tahů
  -> plánování pořadí tahů
  -> vložení namáčení, čištění a čekání
  -> malířský plán
       -> 2D simulátor
       -> validátor stroje
       -> G-code postprocesor
```

Každý krok bude mít jasně definovaný vstup a výstup, aby šel samostatně testovat a později nahradit lepším algoritmem.

## 6. Doménový model

### 6.1 Projekt

Projekt obsahuje:

- odkaz nebo vloženou kopii zdrojového obrázku,
- historii nedestruktivních úprav,
- cílový rozměr malby,
- paletu a materiálové profily,
- profil štětce,
- pracovní prostor,
- strategii generování tahů,
- malířský plán,
- nastavení simulace,
- profil stroje a exportu,
- verzi datového formátu a algoritmů.

### 6.2 Profil barvy

Minimální vlastnosti:

- stabilní identifikátor a název,
- zobrazovací barva,
- změřená výsledná barva na zvoleném podkladu,
- kryvost a průhlednost,
- relativní viskozita,
- očekávaná vydatnost,
- doba schnutí,
- povolené kombinace a pořadí vrstev,
- odkaz na příslušnou vaničku.

V první verzi mohou mít fyzikální parametry zjednodušené výchozí hodnoty.

### 6.3 Profil štětce

- šířka stopy,
- tvar stopy,
- minimální překrytí,
- kapacita barvy,
- rychlost úbytku barvy,
- bezpečná výška,
- pracovní poloha nebo rozsah osy Z,
- výchozí pracovní rychlost,
- čisticí sekvence.

### 6.4 Pracovní zóny

Každá zóna má identifikátor, typ, tvar, rozměr, pozici a bezpečnou výšku přejezdu. Typy zón:

- `canvas`,
- `paint`,
- `water`,
- `wipe`,
- `parking`,
- `forbidden`.

### 6.5 Malířský plán

Malířský plán je strojově nezávislý seznam operací. Předpokládané operace:

- `Move` – bezpečný přesun bez malování,
- `Stroke` – jeden parametrizovaný tah,
- `LoadPaint` – nabrání barvy,
- `CleanBrush` – opláchnutí,
- `WipeBrush` – otření nebo odstranění vody,
- `Wait` – technologická prodleva,
- `ToolUp` a `ToolDown` – pouze tam, kde jsou potřeba explicitně,
- `Park` – bezpečné ukončení nebo přerušení.

Příklad serializované operace:

```json
{
  "type": "stroke",
  "points": [[20.0, 30.0], [100.0, 80.0]],
  "paintId": "blue",
  "pressure": 0.6,
  "speedMmPerMin": 500,
  "expectedLoadStart": 0.8,
  "expectedLoadEnd": 0.35
}
```

Nejde o příkaz pro GRBL. Je to interní reprezentace, kterou postprocesor rozvine na platný G-code.

## 7. Barevný model a míchání

### 7.1 První verze

Posterizace vybírá pouze z reálně dostupných barev. Optické odstíny mohou později vznikat hustotou čar, tečkováním nebo překrytím transparentních vrstev, ale základní MVP s nimi nemusí počítat.

### 7.2 Další rozšíření

Fyzické míchání bude založeno na kalibrovaných receptech, například poměru několika pigmentů, nikoliv na aritmetickém průměru RGB. Každý recept bude mít změřený výsledek na konkrétním podkladu.

Možné režimy:

- předem připravená směs ve vlastní vaničce,
- vrstvení transparentních barev,
- optické míchání sousedními tahy,
- automatická příprava směsi jako budoucí hardwarové rozšíření.

## 8. Generování tahů

### 8.1 Vstup

- mapa barevných oblastí,
- fyzický rozměr obrazu,
- profil štětce,
- požadované překrytí,
- povolené směry tahů,
- model spotřeby barvy,
- omezení pracovního prostoru.

### 8.2 Výstup

Seznam tahů s geometrií, barvou, rychlostí, přítlakem nebo pracovní výškou a předpokládanou spotřebou.

### 8.3 Pořadí

Optimalizátor bude zvažovat:

- seskupení podle barvy,
- minimalizaci čištění a přejezdů,
- světlé versus tmavé vrstvy,
- překrývání oblastí,
- technologické čekání na zaschnutí,
- omezení délky tahu podle zbývající barvy,
- bezpečné přerušení dlouhého tahu.

Optimalizace nesmí měnit zamýšlený vizuální výsledek jen kvůli kratší dráze.

## 9. Model namáčení a čištění

`LoadPaint`, `CleanBrush` a `WipeBrush` jsou parametrizované procedury. Postprocesor je překládá na konkrétní sekvence pohybů podle profilu zařízení.

Příklad `CleanBrush`:

1. zvednout nástroj,
2. bezpečně přejet nad vodu,
3. ponořit štětec,
4. provést definovaný počet čisticích pohybů,
5. zvednout štětec,
6. přejet na otírací zónu,
7. provést otírací pohyb,
8. pokračovat další operací.

Plánovač musí čistit štětec při změně nekompatibilní barvy. U stejné barvy stačí podle modelu spotřeby vložit nové namočení.

## 10. Simulátor

První simulátor bude rychlý dvourozměrný rasterový model. Tah vykreslí jako stopu podél zadané křivky. Model má zahrnovat:

- tvar a šířku štětce,
- tlak nebo pracovní výšku,
- kryvost barvy,
- postupný úbytek barvy,
- rychlost pohybu,
- překrytí s již namalovanými vrstvami,
- jednoduchou texturu a variaci okraje stopy.

Simulátor má mít dva režimy:

- rychlý náhled výsledku,
- animované přehrání operací s vykreslením pohybu stroje.

Simulace je odhad, nikoliv fyzikální záruka. Pozdější kalibrace bude porovnávat simulované a skutečné zkušební tahy.

## 11. Postprocesor a G-code

Postprocesor převádí malířský plán na dialekt cílového stroje. Výchozí profil bude předpokládat GRBL a standardní pohyby:

- `G0` pro bezpečný přejezd,
- `G1` pro řízený pohyb,
- `G4` pro čekání,
- `G21` pro milimetry,
- `G90` pro absolutní souřadnice,
- volitelně `M3`/`M5` nebo jiný konfigurovaný mechanismus nástroje.

Parametr tlaku není přímo příkaz GRBL. Profil stroje jej převede buď na polohu osy Z, nebo na jednu z podporovaných poloh serva.

Každý export musí obsahovat:

- bezpečnou inicializační hlavičku,
- explicitní jednotky a režim souřadnic,
- zvednutí nástroje před rychlým přejezdem,
- kontrolované pracovní rychlosti,
- bezpečné parkování na konci,
- komentáře identifikující významné operace,
- metadata projektu a verzi postprocesoru v komentáři.

## 12. Validace a bezpečnost

Export se zablokuje při kritické chybě:

- pohyb mimo pracovní rozsah,
- zásah do zakázané zóny,
- rychlý XY přejezd se spuštěným štětcem, pokud není součástí tahu,
- chybějící nádoba pro použitou barvu,
- neznámá transformace mezi plátnem a strojem,
- nepodporovaný příkaz cílového profilu,
- neplatná nebo záporná rychlost,
- pracovní Z mimo bezpečný rozsah.

Nekritické situace vyvolají varování, například příliš mnoho čištění, velmi dlouhou dobu malby nebo příliš malý detail vůči šířce štětce.

Před prvním reálným během musí aplikace nabídnout „suchý běh“ se stále zvednutým nástrojem.

## 13. Uživatelské rozhraní

Navrhované hlavní kroky UI:

1. **Obraz** – import, ořez a fyzický formát.
2. **Paleta** – dostupné barvy, posterizace a ruční korekce.
3. **Tahy** – štětec, strategie, hustota a pořadí.
4. **Pracoviště** – plátno, barvy, voda, otírání a limity stroje.
5. **Simulace** – výsledný vzhled, animace a statistiky.
6. **Export** – validace, profil stroje a G-code.

Každý krok bude možné navštívit znovu. Změna dřívějšího kroku označí navazující výpočty jako neaktuální a nabídne jejich přepočet.

## 14. Navržená technická architektura

Předběžně preferovaná varianta:

- desktopový obal: Tauri,
- UI: React a TypeScript,
- vykreslení: Canvas 2D, případně WebGL pro náročnější simulaci,
- výpočetní jádro: Rust,
- projektová data: verzovaný JSON plus vložené nebo přidružené binární podklady,
- testy UI a integrace: TypeScript,
- testy geometrie, plánovače a postprocesoru: Rust.

Jádro bude oddělené od UI a rozdělené přibližně na moduly:

```text
image-processing
palette
stroke-generation
planning
workspace-geometry
simulation
validation
postprocessors
project-format
```

Technologii definitivně potvrdíme během technického prototypu. Klíčové je zachovat doménové hranice, nikoliv konkrétní framework.

## 15. Nefunkční požadavky

- Všechny vzdálenosti uvnitř doménového jádra budou v milimetrech.
- Barevné transformace musí být deterministické při stejném nastavení.
- Dlouhé výpočty musí být zrušitelné a nesmí blokovat UI.
- Projekt se nesmí poškodit při pádu během ukládání; použije se atomické uložení.
- Výpočet malířského plánu musí být reprodukovatelný pomocí uloženého seedu, pokud používá náhodnou texturu.
- Exportovaný G-code musí být textově prohlédnutelný a doplněný komentáři.
- Kritické geometrické a exportní funkce musí mít automatické testy.
- Cílovou platformou první verze je Windows; architektura nemá bránit pozdějšímu portu.

## 16. Milníky

### M0 – Upřesnění domény a technický průzkum

Výstupy:

- potvrzený typ kinematiky a mechanismus zvedání štětce,
- předběžný profil pracovního prostoru,
- vybraný technologický stack,
- vzorové obrázky a očekávané výstupy,
- definovaný formát malířského plánu,
- krátký prototyp převodu jedné interní čáry na G-code.

Akceptace: na jednom konkrétním příkladu lze ručně sledovat cestu od vstupní oblasti přes interní operace až po validní G-code.

### M1 – Kostra aplikace a projektový formát

Výstupy:

- desktopová aplikace se základní navigací,
- založení, uložení a otevření projektu,
- import obrázku,
- nastavení rozměru plátna,
- verzovaný datový formát a migrace jeho první verze.

Akceptace: projekt s obrázkem a rozměry přežije zavření a znovuotevření aplikace beze změny.

### M2 – Paleta a posterizace

Výstupy:

- editor maximálně osmi fyzických barev,
- perceptuální přiřazení obrazu k paletě,
- ovládání detailu a odstranění malých oblastí,
- ruční přemapování barev,
- porovnání originálu a výsledku.

Akceptace: uživatel vytvoří a uloží reprodukovatelnou mapu barev pouze z dostupné palety.

### M3 – Generátor základních tahů

Výstupy:

- profil jednoduchého plochého nebo kulatého štětce,
- rovnoběžné výplňové tahy,
- ořez tahů podle barevných oblastí,
- nastavení směru, rozestupu a překrytí,
- vizualizace pořadí tahů.

Akceptace: žádný pracovní tah neleží mimo cílové plátno a všechny dostatečně velké barevné oblasti jsou pokryty v definované toleranci.

### M4 – Pracovní prostor a obsluha barev

Výstupy:

- editor plátna, vaniček, vody, otírání a parkování,
- model kapacity štětce a úbytku barvy,
- automatické operace namočení, čištění a otření,
- základní optimalizace pořadí podle barev.

Akceptace: kompletní plán používající více barev obsahuje potřebné obslužné operace a žádný jeho pohyb neprotíná zakázanou zónu.

### M5 – Simulace

Výstupy:

- rasterová simulace stopy štětce,
- vizualizace úbytku barvy,
- animované přehrávání plánu,
- samostatné zobrazení malby a přejezdů,
- statistiky délky, času, tahů, namočení a čištění.

Akceptace: simulátor deterministicky přehraje celý malířský plán a jeho časová osa odpovídá pořadí operací.

### M6 – GRBL postprocesor a bezpečnostní validace

Výstupy:

- konfigurovatelný profil stroje,
- převod interních operací na standardní G-code,
- převod přítlaku na Z nebo diskrétní stav nástroje,
- geometrická a příkazová validace,
- režim suchého běhu,
- export souboru s komentáři a statistikami.

Akceptace: referenční malířský plán projde validací a vzniklý G-code lze načíst do běžného GRBL náhledu bez neznámých příkazů nebo pohybu mimo limity.

### M7 – Kalibrace a první fyzický test

Výstupy:

- kalibrační obrazec čar a barevných polí,
- nastavení nuly, měřítka a pracovních poloh Z,
- měření reálné šířky a kryvosti tahu,
- porovnání simulace s fotografií výsledku,
- korekce profilu štětce a spotřeby.

Akceptace: zařízení bezpečně vytvoří jednoduchý vícebarevný referenční obraz v očekávaném měřítku a bez ruční úpravy exportovaného G-code.

### M8 – Pokročilé tahy a směsi

Možná rozšíření po stabilizaci základní verze:

- konturové tahy,
- křížové šrafování a tečkování,
- kalibrované recepty směsí,
- transparentní vrstvení,
- model schnutí,
- více štětců nebo automatická výměna nástroje,
- kamerová kontrola a korekce,
- přímé odesílání G-code a sledování stavu stroje.

## 17. Testovací strategie

- Jednotkové testy barevných převodů, geometrie a transformací.
- Referenční „golden“ testy posterizovaných obrazů.
- Vlastnostní testy zajišťující, že generované tahy zůstávají v povolené geometrii.
- Snapshot testy malířského plánu a G-code.
- Integrační test: obrázek -> paleta -> tahy -> plán -> simulace -> G-code.
- Test přerušení a opakování dlouhého výpočtu.
- Ruční vizuální testy simulace.
- Později kalibrační testy na skutečném stroji.

## 18. Rizika

### Fyzická barva neodpovídá obrazovce

Mitigace: materiálové profily, kalibrační vzorník, měření na skutečném podkladu a jasné označení simulace jako odhadu.

### Tah se mění s úbytkem barvy

Mitigace: kapacitní model štětce, dělení dlouhých tahů a experimentálně kalibrovaná křivka úbytku.

### Kapalina způsobí rozpíjení a smíchání

Mitigace: pořadí vrstev, čekání, omezení překreslování mokrých oblastí a pozdější model schnutí.

### Příliš mnoho malých oblastí

Mitigace: minimální velikost prvku vztažená k šířce štětce, morfologické čištění mapy a upozornění v UI.

### Kolize nebo znečištění při přejezdu

Mitigace: bezpečná výška, explicitní zakázané zóny, validace každého segmentu a suchý běh.

### Rozdíly mezi GRBL konfiguracemi

Mitigace: oddělený postprocesor, profil stroje a omezená, explicitně podporovaná podmnožina příkazů.

## 19. Otevřená rozhodnutí

Před dokončením M0 je nutné určit:

1. zda bude stroj XY se servem, nebo XYZ s plynulou osou Z,
2. zda osa Z skutečně umožní řídit přítlak, nebo pouze výšku,
3. typ, tvar a přibližnou šířku prvního štětce,
4. maximální rozměr pracovního prostoru,
5. druh barvy a podkladu pro první testy,
6. zda bude voda a otírací plocha uvnitř stejného XY prostoru jako obraz,
7. zda první verze potřebuje jediný profil stroje, nebo editor více profilů,
8. zda se má projekt distribuovat pouze pro Windows,
9. požadované maximální rozlišení vstupního obrázku a běžná velikost plátna,
10. zda má aplikace později pouze exportovat, nebo také komunikovat se strojem.

## 20. Definice dokončení první použitelné verze

První verze je dokončená, pokud uživatel dokáže bez ručního zásahu do mezivýsledků:

1. načíst obrázek,
2. nastavit fyzický formát,
3. přiřadit jej k paletě nejvýše osmi barev,
4. zkontrolovat a případně upravit posterizaci,
5. vytvořit tahy pro nakonfigurovaný štětec,
6. umístit plátno, barvy, vodu a otírací zónu,
7. přehrát celý proces v simulaci,
8. projít bezpečnostní validací,
9. exportovat standardní G-code pro referenční GRBL profil,
10. provést suchý běh a následně referenční malbu na skutečném zařízení.

## 21. Správa tohoto dokumentu

Tento soubor je hlavní zdroj pravdy pro rozsah a směr projektu. Nová důležitá rozhodnutí se doplní sem, případně do navazujících technických rozhodnutí v adresáři `docs/adr/`. Změna zadání má obsahovat datum, důvod a dopad na milníky.
