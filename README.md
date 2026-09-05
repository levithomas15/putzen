# Putzen

Ein Hochdruckreiniger-Simulator im Browser. Erste Person, prozedural erzeugte
Szene, Dreck der sich unter dem Strahl auflöst, und Ton, der komplett im Spiel
erzeugt wird.

```bash
npm install
npm run dev      # http://127.0.0.1:5173
```

## Steuerung

| Taste | Wirkung |
|---|---|
| `W` `A` `S` `D` | Bewegen |
| Maus | Umsehen |
| Linke Maustaste | Abzug halten |
| `1`–`4` oder Mausrad | Düse wechseln |
| `Shift` | Rennen |
| `Leertaste` | Springen |
| `Tab` | Checkliste ein-/ausblenden |
| `Esc` | Pause |

## Wie der Dreck funktioniert

Jede putzbare Fläche hat eine eigene Maske (eine Textur):

| Kanal | Inhalt |
|---|---|
| R | Dreck — wird beim Putzen abgezogen |
| G | Variation — steuert Algengrün gegen braunen Schmutz |
| A | Nässe — wird beim Putzen addiert und trocknet weg |

Zum Putzen wird das Objekt **in seine eigene Maske gerendert**, wobei die UVs
als Bildschirmposition dienen und der Shader die Weltposition interpoliert
bekommt. Jedes Texel rechnet damit seinen echten Abstand zum Wasserstrahl aus.

Der Umweg ist nötig: Ein einzelner Raycast-Treffer würde nur einen Punkt setzen,
der Strahl zöge eine dünne Linie und risse an jeder UV-Naht ab. Über die
Weltposition entsteht der korrekte Fußabdruck, auch über Nähte und um Ecken.

Weil RGB und Alpha in WebGL getrennte Blend-Gleichungen haben dürfen, erledigt
ein Durchgang beides: RGB mit `ReverseSubtract` trägt Dreck ab, Alpha mit `Add`
legt Nässe auf.

Eine kleine Tiefenkarte aus Sicht der Düse verhindert, dass man durch Wände
putzt.

## Fortschritt

Die Maske wird über eine Kette von 4×-Reduktionen auf 4×4 heruntergerechnet und
per `readRenderTargetPixelsAsync` ausgelesen — nicht blockierend, also ohne
Ruckler.

Der Wert wird gegen den **Anfangsdreck** normiert, nicht gegen 1.0. Der
UV-Atlas ist nie ganz gefüllt und der Startdreck ungleich verteilt; nur so
bedeutet 100 % wirklich "nichts mehr da".

## Keine Assets

Nichts wird geladen — alles entsteht beim Start:

- **Texturen**: Rauschen, Voronoi und Musterfunktionen auf der GPU in
  Render-Targets gebacken (`src/world/materials/surfaces.js`), daraus Albedo,
  Roughness/Metalness und eine per Sobel abgeleitete Normal-Map.
- **Modelle**: im Code gebaut (`src/world/geometry/`). Alle Kanten sind gefast —
  messerscharfe Würfel sind das auffälligste Amateur-Merkmal in 3D.
- **Licht**: Rayleigh-Streuungs-Himmel, per PMREM zur Environment-Map gebacken.
- **Ton**: Rauschen, Filter und Oszillatoren über WebAudio. Der Aufprallklang
  hängt vom getroffenen Material ab; die Belohnungstöne steigen über die
  Flächen hinweg eine Tonleiter hinauf.

## Aufbau

```
src/
├── core/       Renderer, Postprocessing, Eingabe
├── world/      Szene, Himmel, Geometrie, Materialien
├── dirt/       Maske, Maler, Fortschrittsmessung
├── player/     Steuerung, Hochdruckreiniger
├── fx/         Strahl, Spritzer, Nebel
├── audio/      Strahl-, Aufprall-, Pumpen- und Belohnungsklänge
└── ui/         HUD
```

## Prüfen

```bash
npm test         # Funktionstest: Shader, Fortschritt, Verdeckung
npm run shot     # Screenshots nach shots/
```

Beide laufen headless über Chromium. Dort rendert WebGL per SwiftShader in
Software: Bilder und Verhalten stimmen, **Bildraten sind nicht aussagekräftig**.

Nützliche URL-Parameter zum Eingrenzen von Fehlern:
`?q=low|medium|high`, `?post=0`, `?ao=0`, `?bloom=0`, `?smaa=0`,
`?bake=0.25` (kleinere Texturen), `?mask=0.3` (kleinere Masken),
`?nolock=1` (ohne Mauszeiger-Fang).
