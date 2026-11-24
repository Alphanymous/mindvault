# Feature guide (v0.3)

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

## Writing
Edit mode has a formatting bar: link a note `[[ ]]`, heading, bold, italic, task, tag and code. Ctrl+B and Ctrl+I work too, and Ctrl+Z undoes any of them.
- Buttons toggle: bold on bold text removes it; heading and task replace a marker already on the line (`# Title` becomes `## Title`, `- milk` becomes `- [ ] milk`) and apply to every selected line.
- **Tag** on selected words turns them into a tag ("deep work" becomes `#deep-work`).
- Read mode shows Obsidian-style callouts (`> [!tip] Title`; without a title the type is shown), task lists as cards, and code blocks with the language and a copy button.
- Under a note, **Mentioned in** quotes the line of each note that links to it, including links written by slug or file name.

## Graph
- **Cloud** (default) draws every note as a star in one round cloud, with each region (top-level folder) holding together as its own patch. **Atlas** shows one glowing orb per region on a ring; click an orb to fly in and see its notes, click empty space (or press Esc) to go back to the ring.
- The **Cloud / Atlas** switch sits at the top left of the graph page and is remembered on the device. **Open in graph** from a note always opens Cloud centred on that note, without changing the remembered choice.
- The **Regions** list flies to a region in either view. Region colours come from the folder name, so they stay the same when folders are added, and match the Clusters page.
- Notes no longer have a mini graph; use **Open in graph** instead.
- Keys: F show everything, Tab next connection, Enter open, Esc let go (a selected note first, then back out of an Atlas region).

## Clusters & Tags
The **Clusters** page (sidebar, or `>` in the palette) shows each region (top-level folder) with its size, how much of it is linked and its most linked note, plus tag usage, tags used only once, the two tags that appear together most, and the most linked items.

## Reader and highlights
PDFs open in the app (PDF / Text / Edit switch). Select text, choose a color. Web clips and notes support highlights in Read mode. The Highlights panel lists them; **Note** creates a note with the quote and a link back (PDF notes link to the page). Highlights are stored with the item and sync like any edit.

## Keyboard
`?` shows all shortcuts. Letter shortcuts are ignored while typing in a field.

## Voice
Capture → **Dictate** uses the browser speech service (Chrome, Edge, Safari). Not available in the Windows app (Electron has no speech service) and usually not in the Android app's WebView; use the keyboard's microphone key there.

## Android widget and shortcuts
Add the **Mindvault** widget from the widget picker, or long-press the app icon for Capture / Voice / Search.
