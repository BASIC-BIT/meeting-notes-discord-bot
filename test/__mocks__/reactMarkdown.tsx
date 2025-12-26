import React from "react";

type ReactMarkdownProps = {
  children?: React.ReactNode;
};

export default function ReactMarkdown({ children }: ReactMarkdownProps) {
  return <>{children}</>;
}
