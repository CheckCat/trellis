import { useCallback, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../shared/api/client";
import type { PublicQuiz } from "../../shared/api/types";

/**
 * What the most recently checked set's submission told the caller — and
 * nothing about the options that were not checked, because the backend
 * response never carries them (`routes/quiz.ts`'s multi-select contract).
 * `allChosenCorrect` + `correct: false` is the one deliberate hint: every
 * pick was right, but the set is incomplete — WHICH options are missing
 * stays unknown, so the view can only say "not all of them".
 */
export interface MultiQuizVerdict {
  correct: boolean;
  /** Per-option verdicts keyed by option id — chosen options only. */
  options: Record<string, { correct: boolean; explanation?: string }>;
  allChosenCorrect: boolean;
}

/**
 * Drives one multi-select quiz's flow for `MultiQuizView`: a checked set,
 * one submission of the whole set, one verdict. Mirrors `useQuiz`'s product
 * model — unlimited attempts, nothing stored, a passed lesson never
 * un-completes — and its staleness rule: touching any checkbox clears the
 * verdict, so a badge never describes a set the learner is no longer
 * looking at.
 */
export function useMultiQuiz(courseId: string, lessonId: string, quiz: PublicQuiz) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [verdict, setVerdict] = useState<MultiQuizVerdict | undefined>(undefined);

  const mutation = useMutation({
    mutationFn: (optionIds: string[]) => api.answerMultiQuiz(courseId, lessonId, optionIds),
    onSuccess: (data) => {
      const perOption = data.options ?? [];
      setVerdict({
        correct: data.correct,
        options: Object.fromEntries(
          perOption.map((option) => [option.id, { correct: option.correct, explanation: option.explanation }]),
        ),
        allChosenCorrect: perOption.every((option) => option.correct),
      });
      if (data.correct) {
        // Re-fetch rather than hand-patch the cache — same reasoning as
        // useQuiz: the response carries fresh module/course counters this
        // hook doesn't otherwise see.
        void queryClient.invalidateQueries({ queryKey: ["courseProgress", courseId] });
      }
    },
  });

  const toggle = useCallback((optionId: string) => {
    setVerdict(undefined);
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(optionId)) {
        next.delete(optionId);
      } else {
        next.add(optionId);
      }
      return next;
    });
  }, []);

  const submit = useCallback(() => {
    // Submission order = the quiz's own option order, not click order:
    // deterministic for the backend and for anyone reading the request.
    const optionIds = quiz.options.filter((option) => selected.has(option.id)).map((option) => option.id);
    setVerdict(undefined);
    mutation.mutate(optionIds);
  }, [mutation, quiz.options, selected]);

  return {
    selected,
    toggle,
    submit,
    verdict,
    isPending: mutation.isPending,
    isError: mutation.isError,
  };
}
