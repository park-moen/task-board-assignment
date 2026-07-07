interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label: string;
}

export function Input({ value, onChange, placeholder, label }: Props) {
  return (
    <label className="search-input">
      <span className="sr-only">{label}</span>
      <input
        type="search"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}
