import { Alert, Button, Group } from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";
import { useAuth } from "../contexts/AuthContext";

export function AuthBanner({ message }: { message?: string }) {
  const { loginUrl, loading } = useAuth();
  return (
    <Alert
      color="yellow"
      icon={<IconAlertTriangle size={18} />}
      title="Sign in with Discord"
    >
      <Group justify="space-between">
        <span>
          {message ||
            "Please connect your Discord account to load your servers and billing data."}
        </span>
        <Button
          component="a"
          href={loginUrl}
          variant="filled"
          color="indigo"
          disabled={loading}
        >
          Connect Discord
        </Button>
      </Group>
    </Alert>
  );
}

export default AuthBanner;
