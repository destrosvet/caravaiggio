# Šablony trajektorií a mokré malby

V kroku **Strokes** vyberte **Template**. Šablona nastaví algoritmus, štětec, meze délek tahů, rychlost, tlak a vlastní parametry. Změny parametrů označí variantu jako **Modified**. Náhled obnovíte přes **Regenerate**. Tlačítko **Reset to template** vrátí výchozí hodnoty a zachová aktuální seed.

**Save current settings as** uloží pojmenovanou kopii do **My templates**. Knihovna je lokální, verzovaná v úložišti aplikace; po zavření zůstává dostupná. **Remove from my templates** odstraní položku z knihovny, ale ponechá aktivní parametry projektu. Nelze přepsat vestavěné šablony. Při chybě načtení knihovny se zobrazí zpráva a poškozená data se nepřepisují.

Aktivní algoritmus, všechny jeho parametry, štětec, stínování, priorita detailů, malovaná maska, mediánový filtr i nastavení simulace se ukládají přímo do projektového souboru v14. Projekt tak lze otevřít na jiném počítači bez místní knihovny šablon. Staré projekty v1–v13 zůstávají načitatelné a zachovávají svůj generátor; chybějící nastavení stínování, priority a mediánu jsou vypnutá. U starších nastavení priority zůstává automatická detekce zapnutá. Při dalším uložení se převedou na v14. Starší aplikace nový formát odmítne místo tichého vynechání nových nastavení. Medián je úprava fotografie uložená v projektu, nikoli parametr trajektoriové šablony.

## Sloučení drobných barevných teček

V kroku **Palette** zapněte **Remove colour speckles · median filter**. Výchozí poloměr po zapnutí je **2 mm**; rozsah je 0.5–8 mm, vypnutá volba odpovídá nule. Medián RGB se aplikuje lokálně před přiřazením barev z palety. Nemění seznam pigmentů a neprůměruje hrany jako běžný blur. Odstraní izolované barevné výkyvy, ale při silném nastavení zaniknou i oči, vzory nebo jemná srst.

Stejná implementace s poloměrem v rozměrech fyzického plátna běží v paletovém náhledu i při generování všech trajektorií. Paletový náhled má až 900 px a mapa tahů až 240 px na delší straně; kvůli zaokrouhlení na pixely se jejich nejmenší detaily mohou lišit. Alfa a transparentní masky se zachovávají. Jas původní fotky zůstává dostupný pro směr křivek, prioritu detailů a stínování. Po změně filtru klikněte ve Strokes **Regenerate**. Začněte poloměrem 2 mm a ostatními výchozími parametry.

Fototest s mediánem: `node src/lab/photoProbe.ts artifacts/photos-median 6 4 .35 2`. Poslední argument je poloměr mediánu v mm. Při porovnání barevné přesnosti je třeba pamatovat, že medián mění i paletový cíl; zvýšení této metriky samo o sobě není důkazem zachování detailů původní fotky.

## Reference a algoritmy

| Šablona | Reference | Chování | Parametry algoritmu |
| --- | --- | --- | --- |
| Flow curves | `references/flow-curves.jpg` | Integrace křivek ve směrovém poli odvozeném ze struktury jasu; směr se mění podél tahu. | Vyhlazení pole, vliv obrazu, základní úhel, organické ohýbání, vlnová délka, limit otáčení |
| Curved offsets | `references/cruved-offsets.jpg` | Vnitřní souběžné kontury barevných oblastí z fyzického vzdálenostního pole. | Rozestup kontur, první odsazení, vyhlazení |
| Colour dabs | `references/halftone-points.webp` | Krátké samostatné otisky na posunuté mřížce s variací polohy a směru. | Rozestup, délka otisku, posun pozice, úhel, rozptyl směru |
| Decorative flowing lines | `references/sgraffito.jpg` | Řídké vlny a zákruty malované jemným štětcem. | Rozestup, amplituda, vlnová délka, směr, síla zákrutů |

Sgraffito je zde malovaná vizuální inspirace, nikoli fyzické vyškrabování podkladu. Šablona dekorativních linií ponechává mezery záměrně a není vhodná jako plná krycí výplň. Odsazené kontury mohou vynechat oblasti užší než štětec; zmenšete štětec nebo první odsazení. Šablony zatím tvoří jednu malířskou vrstvu, nikoli skladbu několika různých algoritmů.

Pět malířských stylů používá stejný systém šablon a editor parametrů: **Realism** a **Expressionism** jsou různé konfigurace směrových křivek, **Impressionism** a **Pointillism** používají jednotlivé otisky a **Abstract** vlny se zákruty. Liší se štětcem, hustotou, délkou tahů, tlakem a parametry algoritmu. Nové projekty začínají šablonou Realism. Starší uložené projekty zachovávají svůj generátor a upravitelné parametry jako Project settings; výběr nové šablony je převede na nový algoritmus.

Přidání nového presetu stejného algoritmu vyžaduje pouze novou položku registru. Nový algoritmus potřebuje vlastní generátor a schéma parametrů; jeho ovládání se následně vytvoří automaticky.

## Priorita objektu a detailů

U **Flow curves**, **Realism** a **Expressionism** zapněte v **Subject and detail priority** volbu **Prioritise photo details** a klikněte **Regenerate**. Výchozí stav je vypnutý; nastavení se ukládá do projektu i vlastních šablon.

**Detect photo details automatically** řídí automatickou high-pass mapu. Zapnutá volba kombinuje detaily fotografie s ručně namalovaným důrazem; po vypnutí má prioritu jen namalovaná oblast (případně zachovaná elipsa ze starého projektu). Ruční maska zůstává při přepínání uložená. Parametr Detail scale se zobrazuje pouze pro automatickou detekci. Bez namalované oblasti a bez automatické detekce je mapa důležitosti nulová. Po změně klikněte Regenerate. Přepínač řídí hustotu a význam oblastí; **Follow image structure** samostatně řídí směr křivek a lze ho nastavit na nulu, pokud nemají sledovat strukturu fotky.

- **Extra detail density** zvyšuje hustotu tahů v důležitých místech.
- **Detail scale** určuje fyzickou velikost detailů pro detekci z původní fotky.
- **Simplify background directions** je samostatná výchozí vypnutá volba, která dovolí změnit směrové pole v klidných plochách. Teprve po jejím zapnutí se zobrazí síla **Simplify quiet background**. Samotné zapnutí priority tuto změnu směru neaktivuje; také starší uložená síla 0.8 se bez nového přepínače nepoužije.
- **Minimum detail stroke** dovolí v důležitých místech kratší tahy než základní minimum. Fyzická šířka štětce stále omezuje dosažitelný detail.
- **Paint a focus region** otevře měkký štětec přímo v náhledu. Tažením označíte libovolný tvar; oranžový překryv ukazuje sílu ručního důrazu. **Brush size** nastavuje průměr vůči kratší straně obrazu, **Erase** přepíná na měkkou gumu a **Clear focus** smaže ruční výběr. **Done** zavře editor; **Regenerate** aplikuje změnu na trajektorie. Zoom funguje i při kreslení; posouvání náhledu tažením je při kreslení vypnuté. Maska se ukládá do projektu i vlastní šablony, ve které se vztahuje k relativním souřadnicím plátna. Původní elipsa ze starého projektu zůstává funkční a při prvním kreslení se převede do masky.

Po regenerování zapněte **Importance map** v liště náhledu: světlé oblasti mají vyšší prioritu. Mapa kombinuje odšuměný high-pass jasu původní fotky s případnou malovanou maskou; guma odstraňuje pouze ruční důraz, automatická detekce detailů zůstává, pokud je zapnutá. Nejde o rozpoznávání postav; členité pozadí může mít také vysokou prioritu. Ruční oblast pomůže zdůraznit hlavní objekt i v takové scéně. Generátor nejdřív vytvoří původní základní křivky se stejným rozmístěním a směrem; teprve potom doplňuje lokální detailní tahy podle priority. Středy doplňkových tahů zůstávají uvnitř důležitých oblastí, fyzický otisk štětce může zasáhnout okolí. Bez samostatného zapnutí zjednodušování se směr křivek zachovává. Vyšší hustota prodlužuje dobu malování. Přímé porovnání vyžaduje stejný explicitní seed.

**Overlap** nyní rezervuje okolí trajektorie podle požadovaného rozestupu. Dřívější rezervace podle šířky štětce bránila dalším tahům i při vysokém překryvu. Masky, minimální délka a fyzická šířka štětce mohou nadále ponechat drobné oblasti nepokryté.

Vizuální kontrola: `node src/lab/priorityProbe.ts` ukládá zdroj / malbu bez priority / mapu důležitosti / malbu s prioritou do `artifacts/priority-probe/comparison.png`, trajektorie do SVG a metriky do JSON. Na syntetické postavě ověřuje zvýšení průměrného pokrytí pigmentem; nejde o měření přesnosti rozpoznání objektu. Testy dále kontrolují potlačení šumu, masky, determinismus, překryv, krátké detaily a uložení parametrů.

## Stínovací vrstva z původní fotky

V **Shadow detail from the photo** zapněte **Add shadow strokes** a klikněte **Regenerate**. Nastavení funguje se všemi strategiemi a ukládá se i do vlastních šablon. Výchozí stav je vypnutý, aby otevření projektu ani výběr šablony nepřidávaly nové tahy bez zapnutí funkce.

- **Shadow strength** řídí množství stínovacího pigmentu přes tlak, který nepřekročí nastavený tlak štětce.
- **Detail sensitivity** řídí práh rozdílu jasu a fyzické vyhlazení zdroje: vyšší citlivost zachovává menší detaily.
- **Shadow stroke length** je samostatná délka jemných tahů; nejsou omezené minimální délkou základní výplně.
- **Shadow stroke density** řídí rozestup tahů a jejich překryv.
- **Shadow paint** automaticky vybírá vhodnou tmavší barvu z palety, nebo použije ručně vybranou. Pokud je vybraná barva nedostupná, světlá nebo nepřípustná kvůli akcentním omezením, tah nevznikne.

Algoritmus porovnává vyhlazený jas původní fotky s jasem základní paletové barvy. Vyhlazuje uvnitř barevných oblastí, ne přes jejich hranice. Nejsilnější stíny zpracuje první, po přidání tahu rezervuje okolí, aby se stejné místo opakovaně nehromadilo. Směr se řídí lokálními liniemi stejného jasu; ve slabém gradientu navazuje na dominantní směr základních tahů. Kontroluje celý konzervativní otisk štětce proti maskám a okolním barevným oblastem. Úzké detaily menší než štětec vynechá.

Optimalizace zachovává pořadí základní výplň → případné kontury → stíny. Uvnitř stínovací vrstvy seskupuje tahy podle pigmentu a zkracuje přejezdy. Pokud se barva posledního základního tahu používá i ke stínování, stíny začnou tou barvou a využijí už nabranou náplň. Servisní simulace respektuje doplňování barvy, mytí a úbytek náplně. Výsledek lze posoudit v pixelové malbě s Mixbox, nikoli jen v mapě trajektorií.

Jde o odhad tónové korekce z fotky vůči základní paletě, nikoli zpětnou optimalizaci podle již nasimulovaných pixelů. Tahy nemohou ztmavit obraz pod odstín nejtmavší dostupné barvy. Pro tmavou košili může být potřeba přidat ještě tmavší modrou nebo neutrální barvu. Silné nastavení může vzhled ztmavit příliš; začněte výchozí silou 0.5.

Automatická vizuální kontrola: `node src/lab/shadowProbe.ts` uloží srovnání zdroj / základní malba / malba se stíny a tónovou RMSE do `artifacts/shadow-probe`. Kontrola musí pro stejný vstup snížit tónovou chybu. Další testy ověřují potlačení izolovaného šumu, masky, determinismus, omezení akcentních barev, pořadí vrstev a uložení parametrů.

## Pixelová simulace

**Wet paint simulation** je dostupná v kroku Strokes i při přehrávání Simulation. Nastavení mění vzhled, nikoli trajektorie nebo strojové příkazy:

- **Paint opacity**: množství viditelně uložené barvy.
- **Wet pigment blending**: pronikání do mokré předchozí vrstvy.
- **Pick up underlying paint**: kolik mokré barvy štětec nabere z podkladu.
- **Carry colour distance**: jak dlouho si štětec drží nabranou cizí barvu.
- **Drying time**: časový útlum schopnosti předchozího nánosu se znovu míchat.
- **Bristle texture**: nepravidelnosti pokrytí napříč štětcem.

Míchání pigmentů zajišťuje **Mixbox 2.0.0** v latentním prostoru. Nad ním je vlastní deterministický model transportu: štětec uloží barvu, nabere část mokrého podkladu a přenese ji dál. Nabírání barvy doplní zásobník čistým pigmentem; mytí ho vyprázdní. Simulátor respektuje tlak, náplň, pořadí tahů a časové události existujícího servisního plánu. Náhled Strokes používá výchozí optimalizaci pořadí; v Simulation ji lze vypnout a prohlédnout jiný výsledek.

Při přehrávání se kompletní události ukládají do pixelové vrstvy. Částečně provedený segment se vykreslí do kopie, aby pohyb časové osy nepřidával další barvu. Přetočení zpět nebo změna nastavení přepočítá vrstvu od začátku.

Jde o zjednodušený model, nikoli měření konkrétní barvy nebo štětce. Není zde rozpíjení, gravitace, přesná tloušťka vrstvy ani spektrální kalibrace skutečných pigmentů. Plochý štětec má obdélníkový otisk, který se plynule natáčí podle směru pohybu; kulatý kruhový. Vlákna jsou definovaná napříč štětcem a jejich textura navazuje podél souvislé trajektorie i přes jednotlivé segmenty. Náhledy UI používají nejvýše 640 pixelů na delší straně. Model a servisní události jsou společné s kontrolním nástrojem, ale odlišné rozlišení ovlivňuje detaily.

Při dělení dlouhých křivek na maximální povolenou délku se délka rozloží mezi navazující tahy, aby nevznikaly mezery kvůli vynechání krátkého konce. Krátké samostatné barevné oblasti pod minimální délkou se stále vynechávají. Směrné body se v náhledu uměle nezaoblují.

Vizuální kontrola textury: `node src/lab/brushProbe.ts` vytvoří `artifacts/brush-probe/brush-texture.png`. Vlevo je hladký štětec, vpravo textura 0.35; nahoře kulatý, dole plochý. Každá křivka se skládá z 240 segmentů.

## Automatické ověření

Skutečné uživatelské fotografie jsou v `references/image-test` (pes, kočka, žena a rodina; JPEG i WebP). Jejich opakovatelné porovnání připraví `python src/lab/decodePhotoFixtures.py` (Pillow) a `node src/lab/photoProbe.ts artifacts/photos-default`. Parametry dalších běhů jsou výstupní adresář, šířka štětce, minimum délky a překryv: `node src/lab/photoProbe.ts artifacts/photos-balanced 4 1 .55`. Nástroj uloží fotku, paletový cíl, pixelovou malbu, skutečné trajektorie, HTML přehled a JSON metriky. Používá 8 automatických barev, výšku plátna 400 mm, poměr stran podle fotky a pevný seed. Pillow dekódování není přesná kopie browserového zmenšení ani ruční transformace. Geometrické pokrytí nevyjadřuje kryvost pigmentu: tu ovlivňuje tlak, textura a překrývání. Tyto fotky se automaticky nepovažují za masku hlavního objektu.

Pro členitou srst se ve stávajícím Flow curves osvědčilo minimum tahu 1 mm, štětec 4 mm a Overlap 0.55. Krátké barevné úseky se méně vynechávají a hustší tahy omezují světlé mezery; počet tahů i doba malování výrazně rostou. Je potřeba použít odpovídající fyzický štětec, nikoli jen změnit jeho rozměr v UI. Výchozí Flow curves obchází filtr barevných skvrn podle šířky štětce používaný starším generátorem; tuto odlišnost zachováváme a nyní pouze porovnáváme parametry.

```powershell
node --experimental-strip-types src/trajectoryLab.ts --template all --out artifacts/templates-all
node --experimental-strip-types src/trajectoryLab.ts --template flow-curves --out artifacts/after --baseline artifacts/before/report.json
```

Při porovnání musí mít reference stejnou šablonu, vstup a parametry. Sada všech šablon obsahuje 54 kombinací šesti obrazů a devíti šablon. Každý případ obsahuje geometrickou kontrolu i PNG malby s pigmentovým blendingem, tažením barvy a mapou barevné odchylky. Nastavení custom fixture může obsahovat `palette` ve tvaru `[{"id":"paint-id","hex":"#RRGGBB"}]`, aby se simulovaly skutečné zvolené barvy.

Testy: `node --experimental-strip-types --test test/*.test.ts`. Interakční testy panelu a editoru masky: `npm run test:ui` na Node 24+.

## Rozšíření systému

- `src/core/strategySchema.ts`: názvy, rozsahy, jednotky a výchozí parametry; společná validace.
- `src/core/strokeTemplates.ts`: data vestavěných šablon; žádné UI podmínky pro jednotlivé presety.
- `src/core/referenceStrategies.ts`: generování fyzických trajektorií nových algoritmů.
- `src/project/strokeTemplateLibrary.ts`: validace lokální knihovny.
- `src/ui/StrokeTemplatePanel.tsx`: společný editor, reset a uložené kopie.
- `src/core/paintRaster.ts`: společná pixelová simulace a nastavení.

Použití Mixbox a jeho licenční podmínky jsou uvedeny v `docs/third-party/Mixbox.md`.
