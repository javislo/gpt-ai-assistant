# GPT AI Assistant

<div align="center">

[![license](https://img.shields.io/pypi/l/ansicolortags.svg)](LICENSE) [![Release](https://img.shields.io/github/release/memochou1993/gpt-ai-assistant)](https://GitHub.com/memochou1993/gpt-ai-assistant/releases/)

</div>

GPT AI Assistant is an application that is implemented using the Google Gemini API and LINE Messaging API. Through the installation process, you can start chatting with your own AI assistant using the LINE mobile app.

> [!IMPORTANT]
> This fork uses **Google Gemini only** (no OpenAI or Groq key is needed) and is set up to run on the **Gemini API Free Tier**. See [Vercel deployment (Gemini)](docs/vercel-deployment.md) / [Vercel 部署說明（Gemini）](docs/vercel-deployment.md).

## AI features (Gemini)

| Feature | How it works | Default model |
| --- | --- | --- |
| Text chat | Native `generateContent` API, conversation memory kept per user | `GEMINI_MODEL` = `gemini-3.5-flash-lite` |
| Image understanding | LINE image sent as `inlineData` | `GEMINI_VISION_MODEL` (defaults to `GEMINI_MODEL`) |
| Voice messages | LINE M4A audio transcribed by Gemini audio understanding, then answered like text | `GEMINI_AUDIO_MODEL` (defaults to `GEMINI_MODEL`) |
| Image generation (`draw`) | **Disabled**: not available on the free tier, and there is no fallback to a paid service | — |

When the free tier quota is used up, Gemini returns HTTP 429 and the bot replies that the quota was reached. It never retries with or switches to a paid model.

Required environment variables: `GEMINI_API_KEY`, `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET`. All options are listed in [`.env.example`](.env.example).

> [!NOTE]
> **Looking for a newer take?** [**fermi**](https://github.com/memochou1993/fermi) is the spiritual successor to this project — a self-hostable, chat-based LINE assistant built on Supabase and OpenRouter, where the agent connects and manages itself right from the conversation. It's a reference implementation you run on your own keys.

## Documentations

The upstream documentation below was written for the OpenAI version. For the Gemini setup, follow [docs/vercel-deployment.md](docs/vercel-deployment.md) instead of the OpenAI steps.

- <a href="https://memochou1993.github.io/gpt-ai-assistant-docs/" target="_blank">中文</a>
- <a href="https://memochou1993.github.io/gpt-ai-assistant-docs/en" target="_blank">English</a>

## Credits

- [jayer95](https://github.com/jayer95) - Debugging and testing
- [kkdai](https://github.com/kkdai) - Idea of `sum` command
- [Dayu0815](https://github.com/Dayu0815) - Idea of `search` command
- [mics8128](https://github.com/mics8128) - Implementing new features
- [myh-st](https://github.com/myh-st) - Implementing new features
- [Jakevin](https://github.com/Jakevin) - Implementing new features
- [cdcd72](https://github.com/cdcd72) - Implementing new features
- [All other contributors](https://github.com/memochou1993/gpt-ai-assistant/graphs/contributors)

## Contact

If there is any question, please contact me at memochou1993@gmail.com. Thank you.

## Changelog

Detailed changes for each release are documented in the [release notes](https://github.com/memochou1993/gpt-ai-assistant/releases).

## License

[MIT](LICENSE)
