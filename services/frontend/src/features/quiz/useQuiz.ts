import { useCallback, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";

/**
 * What the most recently submitted answer told the caller about the option
 * it chose. Never more than that: `routes/quiz.ts`'s own contract is "the
 * client learns exactly one bit... plus that option's own explanation" —
 * this hook can't track a per-option verdict map or the correct option's id
 * because the backend response never carries either.
 */
export interface QuizVerdict {
  optionId: string;
  correct: boolean;
  explanation?: string;
}

/**
 * Drives one quiz's answer-submission flow for `QuizView`. There is no
 * "locked" state to represent — the product model is unlimited attempts,
 * never un-completing a lesson once it's right (`routes/quiz.ts`) — so this
 * hook only ever remembers the verdict for the option most recently
 * submitted, and clears it the instant a different option is picked so a
 * stale correct/incorrect badge never lingers on an option the caller
 * didn't just try.
 */
export function useQuiz(courseId: string, lessonId: string) {
  const queryClient = useQueryClient();
  const [verdict, setVerdict] = useState<QuizVerdict | undefined>(undefined);

  const mutation = useMutation({
    mutationFn: (optionId: string) => api.answerQuiz(courseId, lessonId, optionId),
    onSuccess: (data, optionId) => {
      setVerdict({ optionId, correct: data.correct, explanation: data.explanation });
      if (data.correct) {
        // Re-fetch rather than hand-patch the cache: the response also
        // carries fresh module/course counters this hook doesn't otherwise
        // see — same reasoning as LessonView's manual-complete mutation.
        void queryClient.invalidateQueries({ queryKey: ["courseProgress", courseId] });
      }
    },
  });

  const submit = useCallback(
    (optionId: string) => {
      setVerdict(undefined);
      mutation.mutate(optionId);
    },
    [mutation],
  );

  return {
    verdict,
    /** The option currently awaiting a verdict, if any — `undefined` means
     * nothing is in flight. `QuizView` disables every option while this is
     * set, so only one answer can be in flight at a time. */
    pendingOptionId: mutation.isPending ? mutation.variables : undefined,
    isError: mutation.isError,
    submit,
  };
}
