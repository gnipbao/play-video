# Heart & Butterflies — design notes

## Reference profile

- Source: `examples/心脏和蝴蝶.mp4`
- Duration: 15.26 seconds
- Canvas: 1080 × 1440, 3:4 portrait, 60 fps
- Style: photocopied editorial collage; cold paper, broken ink, cobalt butterflies, crimson threads
- Key elements: anatomical-heart silhouette, spreading cracks, red vascular lines, butterflies emerging from the heart, small typewriter caption

The page recreates the visual grammar procedurally. No reference video frame or protected bitmap is embedded in the interactive scene.

## Hero frames

1. **0.0s — hairline fracture**
   - Almost empty cold-white paper.
   - A few black cracks begin around the future heart.
2. **2.6s — heart revealed**
   - Jagged black rupture cells open one after another and merge into an asymmetrical black heart.
   - Two small plaster flakes briefly drop through the opening; no large white panels cover the void.
   - Upper and side cracks remain visibly connected to it.
3. **5.4s — first emergence**
   - Red vessels grow from the heart’s lower point.
   - The first cobalt butterflies rise on red threads.
   - Typewriter caption and signature settle in.
4. **9.0s — dense bloom**
   - Butterflies accumulate over the heart and break beyond the silhouette.
   - Threads form long, slack curves rather than rigid straight lines.
5. **15.0s — open constellation**
   - Butterflies occupy the full frame while the heart remains the dark visual anchor.
   - Long red tethers connect the swarm back to the heart.

## Interaction

- Move the pointer: nearby butterflies are gently pulled toward the pointer and the tether curves bow with the movement.
- Press or tap: the heart pulses and the swarm bursts outward.
- Release / stop moving: butterflies ease back toward their composed orbit, preserving the reference layout.
- Two-finger pinch: the swarm radius subtly follows gesture scale.
- `?auto=1`: deterministic pointer choreography for unattended playback and recording.

## Physical motion pass

- **Wall rupture:** hairline cracks propagate first. From 1.38–2.48s, nine irregular black rupture cells open in sequence and overlap until they become one continuous heart-shaped void, matching the reference's broken-mask rhythm. Two small plaster flakes—one larger, one smaller—detach through the opening and fall with restrained rotation. Large white panels, dust clouds, and secondary chip showers are forbidden because they obscure the reference silhouette.
- **Rupture audio:** live playback uses the audio stream extracted from the supplied reference MP4, so the opening tear and subsequent music stay identical. The procedural paper-tear recipe remains only as the deterministic offline-render fallback.
- **Butterfly launch:** twenty yellow butterflies do not fan out together. Each one has a visibly separated launch time from 3.15s to about 13.6s. Only three settle near the heart; the others rise gently and spread toward a wider outer field over longer 5–7 second flights.
- **Tether physics:** each tether is released about 0.75–0.9s before its butterfly departs. A damped spring-catenary sampled across 16 rope nodes visibly unspools from the single nexus at `(360, 647)`, accelerates downward under gravity, and settles into one clean long U while the butterfly is still inside the heart. The butterfly then pulls the same rope upward; its sag and sideways inertia respond continuously to distance and velocity. Tethers must never appear as instantly drawn Bézier lines or as tangled loops.

## Palette and typography

- Paper: `#eef2f1` with blue-grey wash and deterministic dust.
- Ink: `#111513`, with graphite-grey secondary strokes.
- Butterfly yellow: layered `#f4bf1c`, `#d79a0c`, `#684302`.
- Thread red: `#b3172b`.
- Caption: Courier / monospace, dense and slightly distressed by offset echoes.

## Motion rhythm

- 0.0–1.5s: hairline cracks branch across the paper.
- 1.38–2.55s: jagged rupture cells merge into the heart while one larger and one smaller plaster flake fall through the opening.
- 2.2–4.4s: red vascular network grows.
- 2.35–13.6s: each red tether releases and falls first; its yellow butterfly escapes roughly 0.8s later and gradually pulls the tether upward.
- 8.0–15.3s: wide slow drift, with occasional wing snaps and thread lag.
- The timeline is finite and deterministic; no `Math.random()`, `Date.now()`, or infinite animation repeat.

## Constraints

- Keep the page playable with mouse, touch, and keyboard focus.
- Keep every timed recording element as a `.clip` with `data-start`, `data-duration`, and `data-track-index`.
- The recording composition lives directly in `body`.
- Register one paused GSAP timeline through `Engine.registerTimeline()`.
- Avoid photographic butterfly assets; wings are drawn as procedural vector shapes.
