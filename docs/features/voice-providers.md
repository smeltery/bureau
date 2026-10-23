# Voice input and read aloud

Open **Integrations → Voice** to choose the microphone and read-aloud providers
for your member account. Each choice is saved across devices. Both default to
**Browser**, which uses the browser's speech services without a Bureau API key.
The browser determines which languages and voices are available.

Choose **OpenAI** for recorded microphone transcription or generated read aloud.
Microphone recording requires a secure browser context and microphone permission;
it can work in browsers without the browser speech-recognition API. Click the
microphone to start and stop, or hold **Ctrl+Space**. Bureau transcribes the clip
when recording stops, preserves edits made while waiting, and applies spoken
punctuation in your selected language. Click again while waiting to cancel.
Switching conversations or providers discards pending dictation.

## Configure a credential

In **Integrations → Secrets**, select your member scope and add
`OPENAI_VOICE_API_KEY`, allowing `api.openai.com` with **Authorization**
authentication. A variable of the same name also works. Owners can configure an
office credential shared by members. **Refresh key status** in Voice shows the
name and scope being used, never its value.

Bureau checks the dedicated voice key first, then `OPENAI_API_KEY`. For each
name, member settings override office settings, which override the server
process environment. A scoped secret overrides the variable in that scope;
a secret with incompatible host or authentication restrictions blocks use of
that key instead of silently spending another credential. Member and office
variables use their configured environment files.

OpenAI receives recorded audio for transcription and message text for read aloud.
Generated speech is an AI voice, and usage is billed to the configured API
account. The credential stays on the server. These endpoints require a current
browser session; agent tokens, personal API tokens and loopback access cannot
spend voice credentials.

## Playback and limits

The message's **Speak** button uses your read-aloud choice. Choose an OpenAI voice
in Voice settings. Clicking **Stop**, changing provider or leaving the view
cancels playback. Starting another message stops the previous one. Long messages
are read in sequential passages of at most 4,096 characters; stopping prevents
requests for later passages. Speech generation may take a moment before playback
starts. Browser playback restrictions and provider failures appear beside the
button, so you can retry or select Browser in Voice settings.

Recordings stop after 20 minutes and cannot exceed 25 MiB. Bureau keeps audio in
memory for the request and does not save recordings or generated speech to disk.
Each member may run one voice request at a time, with at most eight across the
office. Requests time out after two minutes. Cancelling cannot undo provider
usage already incurred.

Transcription uses `gpt-transcribe`; read aloud uses `gpt-realtime-2.1-mini` through
a server-side Realtime connection and returns WAV audio to the browser. See
OpenAI's [file transcription guide](https://developers.openai.com/api/docs/guides/speech-to-text)
and [Realtime conversation guide](https://developers.openai.com/api/docs/guides/realtime-conversations).
