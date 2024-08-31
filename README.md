# Meeting Notes Discord Bot

A tool for recording and transcribing audio from Discord voice channels, compiling the results into a detailed meeting summary that includes attendance, chat logs, audio file, and transcription.


## Commands
* `/startmeeting`: Begin recording the meeting. The bot joins the voice channel and starts capturing audio and chat logs.
* `/endmeeting`: Stop the recording and generate a summary. The bot compiles all data into a final report and posts it in the text channel.

## Contribution
Contributions are welcome! If you have ideas for new features or improvements, feel free to open an issue or submit a pull request.

### Running Locally
* Clone the repo
* `yarn install` (and `npm install -g yarn` first if you don't have yarn yet)
* Copy `.env.example` to `.env`, and fill in your Discord Bot Client ID, Secret Token, and Open AI API key
* Run `yarn start`

# License
This project is licensed under the AGPL3 License. See the LICENSE file for details.
