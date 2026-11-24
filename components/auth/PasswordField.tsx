import { useState, type InputHTMLAttributes } from 'react';
import { Eye, EyeOff } from 'lucide-react';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { id: string; fieldName?: string; wrapperClassName?: string };

/** A password input with a show/hide button. The button never submits the form. */
export function PasswordField({ className = '', fieldName = 'password', wrapperClassName = '', ...input }: Props) {
  const [shown, setShown] = useState(false);
  const Icon = shown ? EyeOff : Eye;
  return (
    <div className={`relative ${wrapperClassName}`}>
      <input {...input} type={shown ? 'text' : 'password'} autoCapitalize="none" spellCheck={false} className={`${className} !pr-12`} />
      <button
        type="button"
        onClick={() => setShown(!shown)}
        aria-label={`${shown ? 'Hide' : 'Show'} ${fieldName}`}
        aria-controls={input.id}
        className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-xl text-neutral-500 hover:text-neutral-900 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-600"
      >
        <Icon className="h-[18px] w-[18px]" aria-hidden />
      </button>
    </div>
  );
}
