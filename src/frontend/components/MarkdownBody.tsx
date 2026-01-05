import { Text, TypographyStylesProvider } from "@mantine/core";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getDiscordOpenUrl } from "../utils/discordLinks";
import { uiColors } from "../uiTokens";

type MarkdownBodyProps = {
  content: string;
  compact?: boolean;
  dimmed?: boolean;
};

export default function MarkdownBody({
  content,
  compact = false,
  dimmed = false,
}: MarkdownBodyProps) {
  return (
    <Text size="sm" c={dimmed ? "dimmed" : undefined} component="div">
      <TypographyStylesProvider>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: (props) => {
              const resolvedHref = props.href
                ? getDiscordOpenUrl(props.href)
                : undefined;
              return (
                <a
                  {...props}
                  href={resolvedHref}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    color: uiColors.linkAccent,
                  }}
                />
              );
            },
            ...(compact
              ? {
                  p: (props) => <p {...props} style={{ margin: 0 }} />,
                }
              : {}),
          }}
        >
          {content}
        </ReactMarkdown>
      </TypographyStylesProvider>
    </Text>
  );
}
