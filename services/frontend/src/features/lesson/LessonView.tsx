import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ApiError, api } from "../../api/client";
import type { LessonCompletionMode } from "../../api/types";
import { PracticeView } from "../practice/PracticeView";
import { QuizView } from "../quiz/QuizView";
import { Markdown } from "./Markdown";

const NON_MANUAL_NOTE: Record<Exclude<LessonCompletionMode, "manual">, string> = {
  quiz: "Урок завершается правильным ответом на квиз.",
  practice: "Урок завершается прохождением проверки практики.",
};

/**
 * Single lesson page: renders its Markdown content and, for lessons whose
 * `completionMode` is "manual" (progress/model.ts — plain content or a
 * practice without a `check`), the explicit "mark as done" button. A
 * quiz/practice-graded lesson never gets that button — the backend would
 * 409 a manual completion attempt against it (routes/progress.ts), and
 * hiding the control here is cheaper and clearer than surfacing that error.
 *
 * Two queries instead of one: the lesson's Markdown body comes from
 * `GET /courses/:courseId/lessons/:lessonId` (no status field on that
 * shape), its status/completionMode comes from the course's progress tree
 * (`GET /courses/:courseId/progress`, the same query `CoursePage` uses —
 * same `queryKey`, so completing a lesson here and going back to the course
 * list re-renders both from one cache entry).
 */
export function LessonView({ courseId, lessonId }: { courseId: string; lessonId: string }) {
  const queryClient = useQueryClient();

  const contentQuery = useQuery({
    queryKey: ["lesson", courseId, lessonId],
    queryFn: () => api.getLesson(courseId, lessonId),
  });

  const progressQuery = useQuery({
    queryKey: ["courseProgress", courseId],
    queryFn: () => api.getCourseProgress(courseId),
  });

  const completeMutation = useMutation({
    mutationFn: () => api.completeLesson(courseId, lessonId),
    onSuccess: () => {
      // Re-fetch rather than hand-patch the cache: the response also carries
      // fresh module/course counters this component doesn't otherwise see.
      void queryClient.invalidateQueries({ queryKey: ["courseProgress", courseId] });
    },
  });

  if (contentQuery.isPending || progressQuery.isPending) {
    return <p className="muted-note">Загружаем урок…</p>;
  }

  if (contentQuery.isError || progressQuery.isError) {
    const notFound =
      (contentQuery.error instanceof ApiError && contentQuery.error.status === 404) ||
      (progressQuery.error instanceof ApiError && progressQuery.error.status === 404);
    return (
      <p className="muted-note">{notFound ? `Урок «${lessonId}» не найден.` : "Не удалось загрузить урок."}</p>
    );
  }

  const lessonProgress = progressQuery.data.modules
    .flatMap((module) => module.lessons)
    .find((candidate) => candidate.id === lessonId);

  if (lessonProgress === undefined) {
    // Lesson exists in content (contentQuery succeeded) but not in the
    // progress tree — only reachable if the course changed on disk between
    // the two requests (a rescan). Same "not found" wording as the 404 path
    // above; the cause doesn't change what the user should do about it.
    return <p className="muted-note">Урок «{lessonId}» не найден.</p>;
  }

  const isCompleted = lessonProgress.status === "completed";

  return (
    <>
      <p className="muted-note">
        <Link to="/courses/$courseId" params={{ courseId }}>
          ← К курсу
        </Link>
      </p>
      <h1 className="page-heading">{contentQuery.data.title}</h1>
      {contentQuery.data.content !== undefined && <Markdown source={contentQuery.data.content} />}
      {lessonProgress.completionMode === "quiz" && contentQuery.data.quiz !== undefined && (
        // `LessonDetailResponse.quiz` and the tree's `completionMode` come
        // from two separate queries (see the module doc comment above) —
        // guarding on both, rather than trusting `completionMode` alone, is
        // what keeps this from ever rendering `QuizView` with `quiz` typed
        // as possibly-undefined.
        <QuizView courseId={courseId} lessonId={lessonId} quiz={contentQuery.data.quiz} />
      )}
      {contentQuery.data.practice !== undefined && (
        // Rendered regardless of `completionMode` (unlike QuizView above) —
        // see PracticeView's own doc comment: an unchecked practice still
        // needs the editor, it just doesn't gate completion here.
        <PracticeView courseId={courseId} lessonId={lessonId} practice={contentQuery.data.practice} />
      )}
      <CompletionControl
        mode={lessonProgress.completionMode}
        isCompleted={isCompleted}
        onComplete={() => completeMutation.mutate()}
        isPending={completeMutation.isPending}
        isError={completeMutation.isError}
      />
    </>
  );
}

function CompletionControl({
  mode,
  isCompleted,
  onComplete,
  isPending,
  isError,
}: {
  mode: LessonCompletionMode;
  isCompleted: boolean;
  onComplete: () => void;
  isPending: boolean;
  isError: boolean;
}) {
  if (mode !== "manual") {
    return <p className="muted-note">{isCompleted ? "Урок пройден." : NON_MANUAL_NOTE[mode]}</p>;
  }

  if (isCompleted) {
    return <p className="muted-note">Урок отмечен как пройденный.</p>;
  }

  return (
    <>
      <button type="button" className="mark-done-button" onClick={onComplete} disabled={isPending}>
        {isPending ? "Отмечаем…" : "Отметить пройденным"}
      </button>
      {isError && <p className="muted-note">Не удалось отметить урок пройденным.</p>}
    </>
  );
}
