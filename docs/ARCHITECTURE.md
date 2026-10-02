# bafft architecture and product vision

bafft helps a game master manage a tabletop campaign's people, places, items,
and relationships. Campaign records hold the game system, setting notes, and
image style. World elements also supply the glossary used for transcription.

AI features assist the normal editing workflow: drafting world elements,
generating campaign-consistent images, and transcribing session recordings
with speaker labels and fantasy vocabulary. Generated drafts stay editable
until the owner reviews and saves them.

The repository has three npm workspaces:

- `packages/shared`: shared schemas and types.
- `packages/server`: the API, SQLite persistence, and AI provider integrations.
- `packages/web`: the campaign management and transcript labelling interface.

Local data and credentials stay outside version control. Internal planning,
personal campaign walkthroughs, and real transcription fixtures live under
the gitignored `private/` directory. The public fixture set contains only the
synthetic mock smoke test.
