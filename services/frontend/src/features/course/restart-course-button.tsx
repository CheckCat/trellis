import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../shared/api/client";
import type { CourseProgressResponse } from "../../shared/api/types";
import { ConfirmDialog } from "../../shared/ui/confirm-dialog";
import { RefreshIcon } from "../../shared/ui/icons";
import { plural } from "../../shared/lib/plural";

/**
 * «Перепройти» — the only control in the app that destroys progress, so it
 * asks first and names what will be lost in the question rather than in a
 * vague "are you sure".
 */
export function RestartCourseButton({ courseId, progress }: { courseId: string; progress: CourseProgressResponse }) {
  const queryClient = useQueryClient();
  const [asking, setAsking] = useState(false);

  const resetMutation = useMutation({
    mutationFn: () => api.resetCourseProgress(courseId),
    onSuccess: () => {
      setAsking(false);
      void queryClient.invalidateQueries({ queryKey: ["courseProgress", courseId] });
    },
  });

  return (
    <>
      <button type="button" className="button button--quiet" onClick={() => setAsking(true)}>
        <RefreshIcon />
        Перепройти
      </button>
      {resetMutation.isError && <p className="muted-note">Не удалось сбросить прогресс. Попробуйте ещё раз.</p>}
      {asking && (
        <ConfirmDialog
          title="Перепройти курс?"
          body={
            <>
              <p>
                Будет стёрто {progress.completedLessons}{" "}
                {plural(progress.completedLessons, ["пройденный урок", "пройденных урока", "пройденных уроков"])} курса
                «{progress.title}». Прогресс других курсов останется на месте.
              </p>
              <p className="muted-note">Отменить это действие нельзя — восстановить можно только из файла переноса.</p>
            </>
          }
          confirmLabel={resetMutation.isPending ? "Стираем…" : "Стереть и начать заново"}
          busy={resetMutation.isPending}
          onConfirm={() => resetMutation.mutate()}
          onCancel={() => setAsking(false)}
        />
      )}
    </>
  );
}
