import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";

/**
 * Drives one lesson's practice exercise for `PracticeView`: running the
 * learner's SQL against the course's sandbox, and resetting that sandbox
 * back to its seeded state.
 *
 * `sandboxId` is the lesson's own `practice.sandbox` (`PublicPractice`) —
 * passed explicitly rather than left for the backend to infer, matching
 * `POST /courses/:courseId/sandbox/reset`'s contract that an unspecified
 * `sandboxId` only resolves when a course declares exactly one sandbox
 * (task-008's report: an omitted id on an ambiguous course 400s). The
 * lesson already names the sandbox it needs, so there is nothing to guess.
 */
export function usePractice(courseId: string, lessonId: string, sandboxId: string) {
  const queryClient = useQueryClient();

  const runMutation = useMutation({
    mutationFn: (sql: string) => api.runPractice(courseId, lessonId, sql),
    onSuccess: (data) => {
      // Only a passing check can have completed the lesson
      // (routes/practice.ts never marks it complete otherwise) — re-fetch
      // the progress tree the same way LessonView's manual-complete
      // mutation and useQuiz's correct-answer path already do, rather than
      // hand-patching the cache from this response's own `lesson`/`course`
      // fields.
      if (data.check.present && data.check.passed === true) {
        void queryClient.invalidateQueries({ queryKey: ["courseProgress", courseId] });
      }
    },
  });

  const resetMutation = useMutation({
    mutationFn: () => api.resetSandbox(courseId, sandboxId),
    onSuccess: () => {
      // A reset wipes whatever the learner's prior attempts created —
      // the last run's result/verdict no longer describes the sandbox's
      // current state, so it must not keep being shown as if it still
      // applies to what's there now.
      runMutation.reset();
    },
  });

  return {
    /** The most recently completed run's response, or `undefined` before
     * any run (or after a reset clears it). */
    execution: runMutation.data,
    isRunning: runMutation.isPending,
    runError: runMutation.error,
    run: (sql: string) => runMutation.mutate(sql),
    isResetting: resetMutation.isPending,
    resetError: resetMutation.error,
    resetSucceeded: resetMutation.isSuccess,
    reset: () => resetMutation.mutate(),
  };
}
