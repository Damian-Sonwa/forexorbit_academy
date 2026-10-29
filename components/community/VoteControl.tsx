import { ChevronDown, ChevronUp } from 'lucide-react';

type VoteControlProps = {
  score: number;
  vote: number;
  disabled?: boolean;
  onVote: (value: 1 | -1) => void;
};

export function VoteControl({ score, vote, disabled, onVote }: VoteControlProps) {
  const button = 'inline-flex h-9 w-9 items-center justify-center rounded-full border border-[#e5e5e5] text-[#171717] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 disabled:opacity-50';
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        className={`${button} ${vote === 1 ? 'border-primary-600 bg-[#fff4ea]' : 'bg-[#ffffff]'}`}
        aria-pressed={vote === 1}
        aria-label={vote === 1 ? 'Remove upvote' : 'Upvote'}
        disabled={disabled}
        onClick={() => onVote(1)}
      >
        <ChevronUp className="h-4 w-4" aria-hidden />
      </button>
      <span className="min-w-8 text-center text-sm font-semibold tabular-nums" aria-live="polite">
        <span className="sr-only">Score </span>
        {score}
      </span>
      <button
        type="button"
        className={`${button} ${vote === -1 ? 'border-primary-600 bg-[#fff4ea]' : 'bg-[#ffffff]'}`}
        aria-pressed={vote === -1}
        aria-label={vote === -1 ? 'Remove downvote' : 'Downvote'}
        disabled={disabled}
        onClick={() => onVote(-1)}
      >
        <ChevronDown className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
