aws --no-cli-pager ecs update-service `
  --cluster meeting-notes-bot-cluster `
  --service meeting-notes-bot-service `
  --force-new-deployment `
  --region us-east-1