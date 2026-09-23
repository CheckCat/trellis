import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../shared/api/client";

/**
 * Drives one lesson's practice exercise for `PracticeView`: running the
 * learner's SQL against the course's sandbox.
 *
 * There used to be a second mutation here — resetting the sandbox back to
 * its seeded state, behind a button in the toolbar. Both are gone: the
 * backend now re-seeds before every attempt, so "restore the starting
 * state" is not something a learner can ask for at a moment when it isn't
 * already true. What the control used to be FOR — undoing a mess made two
 * lessons ago — stopped existing along with the mess.
 */
export function usePractice(courseId: string, lessonId: string) {
  const queryClient = useQueryClient();

  const runMutation = useMutation({
    mutationFn: (sql: string) => api.runPractice(courseId, lessonId, sql),
    onSuccess: (data) => {
      // Only a run where every grading mechanic the lesson declares passed
      // can have completed it (routes/practice/sql.ts never marks it
      // complete otherwise — declare two mechanics and both must pass) —
      // re-fetch the progress tree the same way LessonView's
      // manual-complete mutation and useQuiz's correct-answer path already
      // do, rather than hand-patching the cache from this response's own
      // `lesson`/`course` fields.
      const graded = data.check.present || data.expected.present || data.solution.present;
      const allPassed =
        (!data.check.present || data.check.passed === true) &&
        (!data.expected.present || data.expected.passed === true) &&
        (!data.solution.present || data.solution.passed === true);
      if (graded && allPassed) {
        void queryClient.invalidateQueries({ queryKey: ["courseProgress", courseId] });
      }
    },
  });

  return {
    /** The most recently completed run's response, or `undefined` before
     * any run. */
    execution: runMutation.data,
    isRunning: runMutation.isPending,
    runError: runMutation.error,
    run: (sql: string) => runMutation.mutate(sql),
  };
}
