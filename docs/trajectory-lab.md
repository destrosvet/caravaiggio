# Automatická kontrola trajektorií

Nástroj běží bez UI a používá skutečný `generateStyledStrokes`, optimalizaci pořadí a servisní simulátor aplikace. Nezávislý geometrický evaluator následně vykreslí otisk všech tahů v jejich finálním pořadí. Nekopíruje interní kontrolu pokrytí generátoru a neomezuje otisky na cílovou barevnou oblast: přemalování hranic je tedy vidět.

## Spuštění

```powershell
npm run trajectories
node --experimental-strip-types src/trajectoryLab.ts --style all --out artifacts/before
```

Přímé spuštění přes Node je spolehlivé také v PowerShellu, kde některé verze npm spotřebují pojmenované argumenty. Doporučený runtime projektu je Node 24+. Nástroj funguje i na Node 22 s uvedeným přepínačem.

Výstup obsahuje `index.html`, strojově čitelný `report.json`, plány JSON, SVG geometrické diagnostiky, PNG pixelové malby s Mixbox a PNG barevné odchylky. HTML je samostatný lokální report bez síťových závislostí; otevřete ho v prohlížeči. Výstupy v `artifacts/` nejsou verzované. Parametr `--template all` vyhodnotí všech devět šablon včetně nových strategií (54 případů); `--style all` zachovává sadu původních pěti stylů (30 případů).

Výchozí sada obsahuje plnou plochu, osm barevných oblastí, diagonální hranici, kruhové oblasti, jemné detaily a ostrůvky s maskou. Volba `--style all` spustí všech pět presetů, celkem 30 případů. Stejný seed `lab-v1` je výchozí při každém běhu. Každý plán se generuje dvakrát a kontroluje se shoda.

## Iterace a regrese

1. Před změnou generátoru spusťte sadu do `artifacts/before`.
2. Upravte generátor.
3. Spusťte stejnou sadu s referencí:

```powershell
node --experimental-strip-types src/trajectoryLab.ts --style all --out artifacts/after --baseline artifacts/before/report.json --tolerance 0.01
```

Návratový kód 1 znamená neplatný plán, nedeterminismus, chybu servisní simulace nebo zhoršení proti referenci. Zhoršení správně namalované plochy, chybějící plochy, špatné barvy nebo zásahu masky o více než 1 procentní bod je výchozí regresní limit. Stejný absolutní limit 0.01 se používá pro normalizovanou barevnou RMSE pixelové simulace. Nový/chybějící případ nebo změněný vstup, štětec, seed či nastavení nelze porovnat se starou referencí a také způsobí chybu. Když měníte nastavení záměrně, nejprve vytvořte novou referenci. Report má nyní schéma v2; reference z prvního geometrického nástroje v1 je nutné vygenerovat znovu.

Bez reference nejsou nízká obrazová skóre automaticky selháním: výchozí stav generátoru chceme nejprve změřit. Report uvádí jednotlivé metriky, nikoli jedno arbitrární celkové skóre. Čas, délky a počet tahů jsou údaje pro porovnání nákladů; automatický regresní limit mají obrazové metriky. `generationMs` zahrnuje dvojí generování a optimalizaci pořadí; není součástí deterministického porovnání.

## Co se měří

- `accuracy`: podíl cílových malovaných pixelů s finálně správnou barvou.
- `coverage`: podíl cílových pixelů zasažených alespoň nějakou barvou.
- `missing`, `wrong`: podíl nepokrytých a finálně špatně obarvených cílových pixelů.
- `spill`: podíl všech pixelů, kde štětec zasáhl masku bez malby.
- `overlap`: podíl všech pixelů zasažených více než jedním tahem; segmenty stejného tahu se nepočítají jako další překrytí.
- Správnost každé barvy zvlášť, počet tahů, nulové délky, extrémy délek, malovaná vzdálenost, počet změn barvy a přímé přejezdy mezi tahy.
- `simulatedRgbRmse`: normalizovaná RGB odchylka cíle a pixelové malby nad cílovými malovanými pixely; obsahuje vliv kryvosti i blendingu. Není to spektrální ani perceptuální měření. Barevná mapa odchylky zobrazuje také maskovanou oblast.
- Doba provedení, přejezdy včetně nabírání/mytí, počet nabírání a čištění podle existujícího simulátoru.
- Neplatné souřadnice, barvy, tlak a rychlost, středové trajektorie mimo plátno a problémy pracovního prostoru.

Mapa chyb: zelená správně, žlutá nepokryto, červená špatná barva, fialová malba v masce.

## Vlastní případy a uložené plány

`--input cesta.json` přijímá barevnou mapu po posterizaci (stejný vstup, který dostává generátor), fyzické rozměry, volitelný štětec a přepsání nastavení. Příklad:

```json
{
  "name": "moje-barevne-plochy",
  "canvas": { "widthMm": 80, "heightMm": 40 },
  "map": {
    "widthPx": 4, "heightPx": 2,
    "paintIds": ["red", "blue"],
    "pixels": [0, 0, 1, 1, 0, 0, 1, 255]
  },
  "brush": { "name": "Round 4 mm", "shape": "round", "widthMm": 4 },
  "settings": { "direction": "horizontal", "geometry": "linear" }
}
```

Hodnota 255 značí místo bez malby. Pro směrování podle hran obrazu přidejte `map.luminance`, pole hodnot 0–1 stejné velikosti. Můžete také přidat `plan` ve formátu `PaintingPlan`: pak se vyhodnotí tento plán místo generování. Při dodání plánu kontrola determinismu pouze potvrzuje neměnnost dodaných dat. Libovolná jména případů se zapisují do reportu, nikoli do názvů souborů.

Evaluator lze zavolat přímo přes `src/core/trajectoryEvaluation.ts`, například nad mapou a plánem z aplikace. Vstupní JSON zatím není importér PNG/JPEG ani projektových souborů; porovnává už připravený barevný cíl, aby šlo izolovaně ladit trajektorie. Výchozí barvy jsou přiřazené indexům. Vlastní RGB paletu lze dodat jako `palette: [{"id":"red","hex":"#B7352D"}, ...]`. Pořadí palety nemusí odpovídat mapě, páruje se podle ID.

## Meze modelu

Výsledný obraz je geometrická diagnostika s plnou kryvostí. Kulatý štětec má kruhový otisk, plochý štětec pevný čtvercový otisk bez otáčení. Používá se skutečná lomená trajektorie plánu v milimetrech, nikoli vyhlazení náhledu UI. Rozlišení hodnocení je rozlišení dodané mapy; jemné vady menší než pixel mohou uniknout. Pro detailní kontrolu zvyšte rozlišení vlastního případu a referenci vytvořte znovu.

Tlak, úbytek barvy, textura štětin, mokré míchání a schnutí nemění geometrický obraz. Tlak a rychlost se validují, servisní simulace pracuje s kapacitou štětce. Otisk přes vnější hranu plátna se v rasteru ořízne; `outsideStrokes` kontroluje středovou trajektorii. Pro fyzickou bezpečnost použijte i stávající validaci/export aplikace. Nástroj není náhradou kalibrace reálného štětce.

Vedle geometrického obrazu je pixelová simulace z `src/core/paintRaster.ts`. Ta zohledňuje Mixbox pigmentové míchání, kryvost, tlak, náplň, schnutí a tažení nabrané barvy. Používá stejné servisní události jako aplikace a dvojnásobné rozlišení vstupní mapy. Není fyzikálně kalibrovaná. Podrobnosti a ovládání viz [stroke-templates.md](stroke-templates.md), licence viz [Mixbox.md](third-party/Mixbox.md).

## Testy evaluatoru

```powershell
node --experimental-strip-types --test test/trajectoryEvaluation.test.ts
```

Testy používají známé ruční plány: ověřují rozlišení děr, špatné barvy a masky, pořadí přemalování, správný počet překryvů, fyzické rozměry při nestejných pixelech a odmítání neplatné geometrie.
