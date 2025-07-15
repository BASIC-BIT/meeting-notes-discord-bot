# Meeting Notes Discord Bot

A tool for recording and transcribing audio from Discord voice channels, compiling the results into a detailed meeting summary that includes attendance, chat logs, audio file, and transcription.

[Add the bot to your server here!](https://discord.com/oauth2/authorize?client_id=1278729036528619633)

## Commands

- `/startmeeting`: Begin recording the meeting. The bot joins the voice channel and starts capturing audio and chat logs.

## Contribution

Contributions are welcome! If you have ideas for new features or improvements, feel free to open an issue or submit a pull request.

### Running Locally

- Clone the repo
- `yarn install`
- Install FFMPEG (`choco install ffmpeg` if you have Chocolatey)
- Copy `.env.example` to `.env`, and fill in your Discord Bot Client ID, Secret Token, and Open AI API key
- Run `yarn start`

### Development Setup

This project uses pre-commit hooks to ensure code quality. To set up the development environment:

1. **Initial Setup** (for new developers):

   ```bash
   npm run init
   ```

   This command will:

   - Install dependencies with legacy peer deps support
   - Initialize Husky for Git hooks
   - Set up the pre-commit hook for linting

2. **Pre-commit Hook**:

   - Automatically runs ESLint and Prettier on staged files before each commit
   - Auto-fixes code style issues and stages the changes
   - Ensures code style consistency across the project
   - To bypass the hook in emergency situations: `git commit --no-verify`

   **Note**: The pre-commit hook will automatically stage any files modified by the linters, ensuring your commits include all formatting fixes.

3. **Manual Linting**:
   ```bash
   npm run lint      # Run ESLint with auto-fix
   npm run prettier  # Format all files with Prettier
   ```

### CI/CD/Infrastructure

This project uses GitHub actions for deployment, and AWS for hosting, managed by Terraform.

# License

This project is licensed under the AGPL3 License. See the LICENSE file for details.
