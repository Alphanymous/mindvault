# Feature guide (v0.2)

## Home and collections
Home shows what you were reading, your prompt shelf, pinned items and collections. A collection is a saved filter (type, tag, folder, text, "updated in the last N days", "never opened", pinned). Built-ins: Pinned, Unread web clips, This week, PDFs, All prompts. Open the Library, apply filters, press **Save as collection**. "Unread" is tracked per device.

## Search
- Plain words: ranked by title, tags, folder, body.
- Word forms and topics work offline: "prices" finds "pricing", "budget" finds finance notes. Results labeled **topic** matched by concept, not by the exact word.
- **Meaning search (optional)**: Settings → Meaning search. Add an OpenAI-compatible embeddings URL and model, press *Build index*. Results labeled **meaning** come from the embeddings. The index stays on the device; note text is sent to your endpoint only when indexing and the query when searching.
- Prefixes: `>` commands, `#` tags, `@` folders and collections.

## Related notes
Every item shows similar items. **Link** appends `Related: [[Title]]` so the connection appears in the graph.

## Prompts
Open **Prompts** for the toolbox. Fill `{{variables}}` once; answers are remembered across prompts on this device. **Copy for** records which model you used it with. **New variant** copies a prompt (frontmatter `variant_of`) so you can reword it without losing the original. **Run it now** appears when a chat endpoint is set in Settings → AI sorting.

## Reader and highlights
PDFs open in the app (PDF / Text / Edit switch). Select text, choose a color. Web clips and notes support highlights in Read mode. The Highlights panel lists them; **Note** creates a note with the quote and a link back (PDF notes link to the page). Highlights are stored with the item and sync like any edit.

## Keyboard
`?` shows all shortcuts. Letter shortcuts are ignored while typing in a field.

## Voice
Capture → **Dictate** uses the browser speech service (Chrome, Edge, Safari). Not available in the Windows app (Electron has no speech service) and usually not in the Android app's WebView; use the keyboard's microphone key there.

## Android widget and shortcuts
Add the **Mindvault** widget from the widget picker, or long-press the app icon for Capture / Voice / Search.
