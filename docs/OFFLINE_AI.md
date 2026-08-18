# Offline AI

DevHelper can run a language model on the machine it is installed on, so AI
features work with no account, no key and no prompt leaving the computer. This
page is what a new machine needs to know.

## The short version

Open **Settings → AI**, tick **Local AI**, and follow what the panel says. It
knows what is missing and offers to fetch it. Nothing here has to be installed by
hand.

## What has to exist, and who provides it

| Piece | Who gets it | Notes |
| ----- | ----------- | ----- |
| The folder `C:/TDM/TDM_OFFLINE_LLMHUB` | DevHelper, silently on first open | Change it in Settings if you keep models elsewhere |
| The **engine** — llama.cpp's `llama-server.exe` and its DLLs | DevHelper, after you confirm | ~18 MB, from the official `ggml-org/llama.cpp` release |
| A **chat model** — a `.gguf` file | DevHelper, after you confirm — or you, by hand | 1.8–4.7 GB depending on which |

The engine is not committed to this repository (a 200 MB binary does not belong in
git) and neither are models (gigabytes, and licensed by their publishers). Both are
fetched on request, which is why a fresh clone or a fresh install has some
downloading to do before the first answer.

## First run on a new machine

1. Settings → AI → tick **Local AI** → **Offline model file**.
2. The panel reports `engine: not installed`. Press **Set up engine**. It shows
   the release tag, the exact filename, its size, the destination and whether a
   checksum was published — then installs it after you press **Download &
   install**. The checksum is verified before anything is unpacked.
3. The panel then says the folder has no chat model. Press **Let DevHelper
   download one**. It offers Qwen2.5 3B Instruct by default, with 7B and Coder 7B
   one click away, and shows a progress bar for the download.
4. Click the model in the list, press **Start model**, wait for
   `running · port NNNNN`.
5. **Test connection**, or open **AI Chat** and ask something.

## Bringing your own model

Drop any `.gguf` into the hub folder. The list refreshes when you come back to the
DevHelper window — no need to press Scan.

It must be an **instruct or chat** model. Embedding models (`bge-*`,
`nomic-embed-*`, anything with `Embedding` in the name) are listed but marked and
refused: they turn text into vectors and have no chat template, so llama.cpp loads
them and then cannot answer. `Qwen3-Embedding` and `Qwen2.5-Instruct` are not the
same kind of thing.

Split models (`…-00001-of-00003.gguf`) are grouped into one entry. An incomplete
set says so rather than failing at load time.

## Choosing a backend

The engine installer defaults to the **CPU** build, which depends on nothing and
works on every machine. On the confirmation card, **Use CUDA instead** is worth it
if you have an NVIDIA GPU and its driver; set **GPU layers** to `-1` afterwards so
the model is actually offloaded. **Vulkan** covers most other GPUs, including
integrated ones, though on shared-memory integrated graphics the gain over CPU is
usually small.

Rough expectations for a 7B Q4_K_M: a few words per second on a laptop CPU, an
order of magnitude faster on a mid-range discrete GPU. The 3B model is roughly
twice the speed of the 7B for noticeably shorter answers.

## Where the settings live

| Setting | Meaning |
| ------- | ------- |
| Context | Tokens the model can see at once. 4096 is a safe default; larger costs memory |
| GPU layers | `0` CPU-only, `-1` offload everything, a number to split |
| Threads | `0` lets llama.cpp choose, which is usually right |
| llama-server path | Only needed if the engine lives somewhere unusual |

## Privacy

Prompts to a local model never leave the machine, and the PHI gateway treats
`127.0.0.1` as a local destination — so with **Trust local models** on in the PHI
settings, redaction can be switched off for offline use while staying on for
hosted APIs.

With both **Local AI** and **Online AI** ticked, the local one answers and nothing
falls back to the internet. A prompt you believed was staying here does not travel
because a server failed to start.

## Troubleshooting

**"engine: not installed" after installing.** The panel looks in the Settings path,
then `<hub>/runtime/`, then `<hub>/`, then `PATH`. If you unpacked the zip
somewhere else, point the *llama-server path* box at the executable.

**Start fails immediately.** The panel shows llama.cpp's own last lines — that is
where the reason is. A missing DLL means the zip was unpacked without the files
next to the exe; a CUDA build on a machine with no NVIDIA driver fails the same
way.

**"The server started but DevHelper could not talk to it."** The server is up but
the request never reached it. Check that `capabilities/default.json` still allows
`http://**:*` — a URL pattern without a port only matches 80 and 443, and removing
that entry breaks every local server including Ollama.

**It is slow.** Expected on a CPU. Use the 3B model, keep the context at 4096, and
if there is an NVIDIA GPU, reinstall the engine as CUDA and set GPU layers to `-1`.
