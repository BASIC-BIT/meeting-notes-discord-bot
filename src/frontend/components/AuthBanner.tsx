import { Alert, Button, Group } from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";
import { useAuth } from "../contexts/AuthContext";

export function AuthBanner({ message }: { message?: string }) {
  const { loginUrl, loading } = useAuth();
  return (
    <Alert
      color="brand"
      icon={<IconAlertTriangle size={18} />}
      title="Connect Discord"
      variant="light"
    >
      <Group justify="space-between" align="center" wrap="wrap">
        <span>
          {message ||
            "Connect your Discord account to load servers, billing, and the Chronote library."}
        </span>
        <Button
          component="a"
          href={loginUrl}
          variant="filled"
          color="brand"
          disabled={loading}
        >
          Connect Discord
        </Button>
      </Group>
    </Alert>
  );
}

export default AuthBanner;
