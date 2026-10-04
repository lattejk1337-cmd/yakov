const DIGITS = '0123456789'.split('');

/** Rolling-digit number: each digit is a strip that scrolls to its value when it changes. */
export function Odometer({ value }: { value: string }) {
  const chars = [...value];
  return (
    <span className="odo" aria-label={value} role="text">
      {chars.map((ch, i) => {
        // Key from the right, so units stay units when the number grows.
        const key = chars.length - i;
        if (!/\d/.test(ch)) {
          return (
            <span key={`s${key}`} className="odo__sep" aria-hidden="true">
              {ch}
            </span>
          );
        }
        return (
          <span key={key} className="odo__col" aria-hidden="true">
            <span className="odo__strip" style={{ transform: `translateY(-${Number(ch) * 10}%)` }}>
              {DIGITS.map((d) => (
                <span key={d}>{d}</span>
              ))}
            </span>
          </span>
        );
      })}
    </span>
  );
}
