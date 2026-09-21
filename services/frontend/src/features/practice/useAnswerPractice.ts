import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";

/**
 * Drives one lesson's `answer` practice: submitting the values the learner
 * typed in and reporting which of them were right.
 *
 * There is no sandbox here — an `answer` assignment is work done outside
 * the platform (Excel, a dashboard), so unlike `usePractice` this hook has
 * no reset, nothing to provision, and nothing that can fail for
 * infrastructure reasons.
 */
export function useAnswerPractice(courseId: string, lessonId: string) {
  const queryClient = useQueryClient();

  const submitMutation = useMutation({
    mutationFn: (answers: Record<string, string>) => api.submitPracticeAnswers(courseId, lessonId, answers),
    onSuccess: (data) => {
      // Only an all-correct submission can have completed the lesson
      // (routes/practice.ts never marks it complete otherwise) — re-fetch
      // the progress tree the way every other completing action does,
      // rather than hand-patching the cache from this response.
      if (data.ok) {
        void queryClient.invalidateQueries({ queryKey: ["courseProgress", courseId] });
      }
    },
  });

  return {
    /** The last submission's verdict, or `undefined` before the first. */
    verdict: submitMutation.data,
    isSubmitting: submitMutation.isPending,
    submitError: submitMutation.error,
    submit: (answers: Record<string, string>) => submitMutation.mutate(answers),
  };
}
