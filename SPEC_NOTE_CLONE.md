# Proyecto: "NoteFlow" — clon de Note Along (extensión de Chrome)

## 1. Objetivo

Construir una **extensión de Chrome (Manifest V3)** que:

1. Captura el **audio de la pestaña activa** (opcionalmente también el micrófono).
2. Lo **transcribe en tiempo real** (streaming).
3. Va **estructurando notas con IA parte por parte** mientras la transcripción avanza (secciones, bullets, decisiones, tareas, preguntas abiertas), no al final.
4. **Envía las notas a Notion automáticamente** al detener la grabación (y con botón "Sincronizar ahora").

Es una herramienta **personal (un solo usuario, BYOK)**: **no hay backend**. Las API keys viven en `chrome.storage.local`. Diseña las interfaces para que luego se pueda añadir un backend sin reescribir.

## 2. Stack (decidido, no cambiar sin preguntarme)

- **Extensión**: WXT (https://wxt.dev) + TypeScript estricto + React + Tailwind. UI principal en **Side Panel** (`chrome.sidePanel`).
- **Captura de audio**: `chrome.tabCapture` + **offscreen document** (MV3). El audio de la pestaña debe seguir sonando (reconectar el stream a `AudioContext.destination`).
- **Procesamiento de audio**: `AudioWorklet` → PCM16 mono 16 kHz.
- **STT (streaming)**: **Deepgram Nova-3** por WebSocket (`language=multi` para mezcla español/inglés, `interim_results=true`, `smart_format=true`, `endpointing`). Interfaz `SttProvider` para poder cambiar luego a Groq Whisper-large-v3-turbo (por chunks de ~5–8 s).
- **LLM de estructuración**: API **compatible con OpenAI** (SDK `openai` con `baseURL` configurable). Proveedor por defecto: **DeepSeek V4.x Flash**. Presets en Ajustes: DeepSeek, Qwen (Alibaba Model Studio, endpoint internacional, modelo flash), Kimi, y "Custom". Verifica los IDs de modelo y URLs vigentes en la documentación oficial antes de codificarlos.
- **Notion**: integración interna (token personal), API REST vía `fetch`. Sin OAuth.
- **Estado/persistencia**: Zustand + **Dexie (IndexedDB)** para sesiones (transcripción, notas, estado de sincronización).
- **Validación**: zod. **Tests**: vitest (reducer de notas, conversor notas→bloques de Notion).
- Gestor de paquetes: pnpm.

> IMPORTANTE: antes de implementar cada integración (Deepgram streaming, tabCapture/offscreen, Notion API, endpoints LLM) **consulta la documentación oficial actual** (WebFetch/WebSearch). No asumas parámetros de memoria; las APIs cambian.

## 3. Arquitectura

```
src/
  entrypoints/
    background.ts        # service worker: orquesta sesión, tabCapture streamId, mensajes
    offscreen/           # captura audio + AudioWorklet + WebSocket STT (vive aquí porque el SW se duerme)
    sidepanel/           # UI React
    options/             # Ajustes (keys, proveedor LLM, Notion, idioma)
  core/
    stt/                 # SttProvider (interface), deepgram.ts, (groq.ts opcional)
    llm/                 # LlmClient (openai-compatible), prompts.ts, structurer.ts
    notes/               # tipos, schema zod, reducer de patches, serialización markdown
    notion/              # client.ts, blocks.ts (notas → bloques), exporter.ts
    storage/             # dexie db, settings
  shared/                # tipos de mensajes entre background/offscreen/sidepanel
```

Flujo: `Sidepanel Start` → background obtiene `streamId` → offscreen captura y envía PCM al STT → transcript final (`is_final`) se emite al background → **Structurer** acumula texto y dispara actualizaciones → reducer aplica patches al estado de notas → UI se actualiza en vivo → al `Stop` se hace pasada final y export a Notion.

## 4. Requisitos funcionales

### 4.1 Captura y transcripción

- Botón Start/Stop/Pause en el side panel. Indicador de nivel de audio y estado de conexión.
- Soportar reconexión automática del WebSocket (backoff), `KeepAlive` cada ~8 s, `CloseStream` al terminar.
- Mostrar transcripción en vivo (parciales en gris, finales en negro), colapsable.
- Selector opcional "incluir micrófono" (mezclar tab + mic) — Fase 5.
- Manejar: pestaña cerrada, permisos denegados, key inválida, sin saldo/errores 4xx/5xx con mensajes claros.

### 4.2 Estructuración incremental con IA (núcleo del producto)

- Disparar una actualización cuando haya **≥ ~120 palabras finales nuevas** o pasen **~45 s** con texto nuevo (valores configurables). Nunca solapar llamadas: cola de 1 en vuelo; si llega más texto, se acumula para la siguiente.
- Cada llamada envía: system prompt estable (para aprovechar caché de prefijo) + **estado actual de las notas (JSON compacto)** + **solo el texto nuevo** (+ ~2 frases de contexto previo). **Nunca** reenviar toda la transcripción.
- El modelo responde **solo JSON** con una lista de **operaciones (patches)**. Validar con zod; si es inválido, reintentar una vez con el error; si falla, conservar el texto para el siguiente ciclo (no perder contenido).
- Esquema de estado: `{ title, sections:[{id, heading, bullets:[{id,text}]}], decisions:[{id,text}], actionItems:[{id,text,owner?,due?}], openQuestions:[{id,text}] }`
- Operaciones: `set_title`, `add_section`, `add_bullet(sectionId, text, afterId?)`, `update_bullet(id, text)`, `remove_bullet(id)`, `add_decision`, `add_action`, `add_question`, `resolve_question(id)`.
- Un reducer **puro y determinista** aplica los patches (con tests). El LLM nunca reescribe el documento completo.
- Reglas del prompt: no inventar datos; ignorar muletillas y charla irrelevante; bullets concisos; fusionar en vez de duplicar; si no hay nada relevante, devolver `{"ops":[]}`; idioma de salida configurable (`auto` = idioma dominante del audio, o forzar es/en).
- Al detener: **pasada final** (barata) sobre las _notas_ (no la transcripción) para: título definitivo, TL;DR de 3–5 líneas, y limpieza/orden de secciones.
- Edición manual: el usuario puede editar/borrar bullets en la UI; esas ediciones son la fuente de verdad (marcar `userEdited` y que el LLM no las sobrescriba).
- Telemetría local: tokens in/out por sesión y costo estimado (precios configurables) visible en la UI.

### 4.3 Notion

- Ajustes: token de integración + destino (**base de datos** o **página padre**). Botón "Probar conexión".
- Al detener (toggle "auto-exportar", activo por defecto) y con "Sincronizar ahora": crear página con propiedades (Título, Fecha, URL de la pestaña, Duración, Tags opcional) y contenido: TL;DR → Secciones (heading_2 + bullets) → Decisiones → Tareas (`to_do`) → Preguntas abiertas → **toggle** con la transcripción completa.
- Respetar límites: ≤100 bloques por request, ≤2000 chars por rich_text (trocear), ~3 req/s con reintento ante 429 (`Retry-After`).
- Idempotencia: guardar `notionPageId` en la sesión; "Sincronizar de nuevo" actualiza/reemplaza el contenido en vez de crear duplicados.
- Verifica en la doc actual la versión de API (`Notion-Version`) y si el destino se identifica con `database_id` o `data_source_id`.

### 4.4 UI (intuitiva, mínima fricción)

- Side panel con 3 zonas: **Header** (Start/Stop, timer, estado, costo), **Notas en vivo** (principal, con animación sutil al aparecer bullets nuevos), **Transcripción** (colapsable).
- Pestañas: "Sesión actual" | "Historial" (lista de sesiones, reabrir, re-exportar, exportar a Markdown, borrar).
- Atajo de teclado para iniciar/detener. Modo oscuro automático.
- Onboarding de 3 pasos en la página de opciones (Deepgram key → LLM key → Notion) con validación en vivo de cada key.

## 5. Calidad y seguridad

- TypeScript `strict`, ESLint + Prettier. Sin `any` salvo justificado.
- **Ningún secreto en el repo**. `.env.example` solo para desarrollo; en runtime las keys van en `chrome.storage.local`.
- Permisos mínimos en el manifest (`tabCapture`, `offscreen`, `sidePanel`, `storage`, `activeTab`; `host_permissions` solo para los dominios de Deepgram, LLM y Notion).
- Logs útiles pero **sin imprimir keys ni contenido sensible**.
- Aviso en Ajustes: el texto transcrito se envía a los proveedores configurados (DeepSeek/Qwen/Kimi operan fuera de EE. UU.); no usar con reuniones confidenciales.

## 6. Plan de trabajo (haz UNA fase a la vez; al terminar cada una: `pnpm build` + tests verdes + commit + dime cómo probarla)

- **Fase 0 — Setup**: scaffold WXT+React+Tailwind, manifest, side panel vacío, página de opciones, README con instrucciones de carga en `chrome://extensions`.
- **Fase 1 — Audio + STT**: tabCapture + offscreen + AudioWorklet + Deepgram streaming. Criterio: abro un video de YouTube, pulso Start y veo transcripción en vivo mientras el audio sigue sonando.
- **Fase 2 — Estructuración**: LlmClient, prompts, reducer + tests, Structurer con cola y disparadores. Criterio: las notas se arman solas mientras hablan; costo estimado visible.
- **Fase 3 — Notion**: cliente, conversor a bloques + tests, export automático y manual, idempotencia. Criterio: al detener aparece la página completa en Notion.
- **Fase 4 — Persistencia e historial**: Dexie, reabrir/re-exportar sesiones, exportar Markdown, recuperación tras cerrar el panel.
- **Fase 5 — Pulido**: mezcla de micrófono, presets de proveedor, atajos, onboarding, manejo de errores/reconexión, selector de plantilla de notas (reunión / clase / podcast).

## 7. Cómo quiero trabajar contigo

- Empieza **en modo plan**: revisa este documento, señala ambigüedades o riesgos técnicos (sobre todo tabCapture/offscreen y límites de Notion) y proponme el plan de la Fase 0–1 antes de escribir código.
- Si una decisión de este documento resulta inviable, explícame por qué y propón una alternativa; no la cambies en silencio.
- Prefiere soluciones simples. Nada de sobreingeniería (sin backend, sin auth propia, sin base de datos remota).
- Comunícate en español; código, comentarios y nombres en inglés.
