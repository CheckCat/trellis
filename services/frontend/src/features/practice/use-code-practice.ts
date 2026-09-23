import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../shared/api/client";

/**
 * Drives one lesson's `code` practice: sending the learner's module to the
 * backend, which runs it case by case and grades it.
 *
 * Nothing to provision and nothing to reset — every run is a fresh child
 * process on the server (plugins/practice/code/run-node.ts).
 */
export function useCodePractice(courseId: string, lessonId: string) {
  const queryClient = useQueryClient();

  const runMutation = useMutation({
    mutationFn: (code: string) => api.runPracticeCode(courseId, lessonId, code),
    onSuccess: (data) => {
      // Only a run where every case passed can have completed the lesson —
      // re-fetch the progress tree the way the other completing actions
      // do, rather than hand-patching the cache from this response.
      if (data.passed) {
        void queryClient.invalidateQueries({ queryKey: ["courseProgress", courseId] });
      }
    },
  });

  return {
    /** The most recently completed run, or `undefined` before any. */
    execution: runMutation.data,
    isRunning: runMutation.isPending,
    runError: runMutation.error,
    run: (code: string) => runMutation.mutate(code),
  };
}
