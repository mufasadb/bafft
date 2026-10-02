# ASR fixtures

Regression harness for `TranscriptionProvider` implementations. The public
fixture set contains only `mock-smoke-test/`: synthetic text matching the mock
provider's canned output. It scores 0% word error rate against `mock` and needs
no audio, credentials, or network access.

Run from the repository root:

```bash
npm run fixtures:run --workspace @bafft/server -- --provider mock
```

## Local-only real fixtures

Real audio and reference transcripts are local-only. Keep them under
`private/data/fixtures/`, which is gitignored, rather than adding them to the
public fixture set. Existing local benchmark material is preserved there;
it is not redistributed with this repository.

One fixture is a directory containing an audio clip and `expected.json`.
Use recordings and transcripts you have permission to process. For example:

```json
{
  "audioPath": "audio.m4a",
  "keyterms": ["Exampleton"],
  "transcript": "GM: Welcome to Exampleton.\nPlayer: I look around."
}
```

`audioPath` is relative to the fixture directory. Speaker labels only need to
be consistent within a fixture; scoring matches them to the vendor's labels.
Case and punctuation are ignored. Include the words actually spoken, including
false starts and fillers. Alternatively supply provider-shaped `words` instead
of `transcript`, but not both.

To benchmark local fixtures, select the private data directory and a provider
configured in your local environment:

```bash
BAFFT_DATA_DIR="$PWD/private/data" npm run fixtures:run --workspace @bafft/server -- --provider assemblyai --diffs
```

## Scores

- **Word error rate (WER):** missed, extra, and substituted words, measured by
  edit-distance alignment.
- **Glossary terms heard:** reference occurrences of keyterms recovered by the
  provider.
- **Speaker attribution:** aligned words assigned to the correct speaker.
- **Confidence sweep:** incorrect and correct words flagged at each confidence
  threshold, to help tune transcript labelling.
