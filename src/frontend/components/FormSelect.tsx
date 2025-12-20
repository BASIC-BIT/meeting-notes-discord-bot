import { Select, type SelectProps } from "@mantine/core";

const PASSWORD_MANAGER_IGNORE_ATTRS = {
  autoComplete: "off",
  "data-lpignore": "true",
  "data-form-type": "other",
  "data-1p-ignore": "true",
  "data-bwignore": "true",
} as const;

export default function FormSelect({ hiddenInputProps, ...rest }: SelectProps) {
  return (
    <Select
      {...rest}
      {...PASSWORD_MANAGER_IGNORE_ATTRS}
      hiddenInputProps={{
        ...PASSWORD_MANAGER_IGNORE_ATTRS,
        ...hiddenInputProps,
      }}
    />
  );
}
