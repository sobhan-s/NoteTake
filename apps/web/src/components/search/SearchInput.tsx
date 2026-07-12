import { Input } from "@/components/ui/Input";

export interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
}

export function SearchInput({ value, onChange }: SearchInputProps) {
  return (
    <Input
      type="text"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder="Search your notes"
      aria-label="Search notes"
      autoFocus
    />
  );
}
