"use client";

import { ArrowDown, ArrowUp, Pencil, Plus, RefreshCcw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type Course = {
  id: string;
  title: string;
  description: string | null;
  slug: string;
  published: boolean;
};

type Lesson = {
  id: string;
  courseId: string;
  title: string;
  slug: string;
  videoProvider: "youtube" | "mux" | "cloudflare";
  videoAssetId: string;
  position: number;
  published: boolean;
};

export default function MasterclassAdminPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState<string>("");
  const [loadingCourses, setLoadingCourses] = useState(false);
  const [loadingLessons, setLoadingLessons] = useState(false);
  const [savingCourse, setSavingCourse] = useState(false);
  const [savingLesson, setSavingLesson] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const [editingCourse, setEditingCourse] = useState<Course | null>(null);
  const [deletingCourse, setDeletingCourse] = useState<Course | null>(null);
  const [editingLesson, setEditingLesson] = useState<Lesson | null>(null);
  const [deletingLesson, setDeletingLesson] = useState<Lesson | null>(null);

  const [courseForm, setCourseForm] = useState({
    title: "",
    slug: "",
    description: "",
    published: true,
  });

  const [editCourseForm, setEditCourseForm] = useState({
    title: "",
    slug: "",
    description: "",
    published: true,
  });

  const [lessonForm, setLessonForm] = useState({
    title: "",
    slug: "",
    videoProvider: "youtube" as "youtube" | "mux" | "cloudflare",
    videoAssetId: "",
    position: 1,
    published: true,
    supportMaterialTitle: "",
    supportMaterialUrl: "",
  });

  const [editLessonForm, setEditLessonForm] = useState({
    title: "",
    slug: "",
    videoProvider: "youtube" as Lesson["videoProvider"],
    videoAssetId: "",
    position: 1,
    published: true,
    supportMaterialTitle: "",
    supportMaterialUrl: "",
  });

  async function loadCourses() {
    setLoadingCourses(true);
    try {
      const response = await fetch("/api/masterclass/admin/courses", {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error("Não foi possível carregar cursos.");
      }
      const data = (await response.json()) as Course[];
      setCourses(data);
      if (!selectedCourseId && data.length > 0) {
        setSelectedCourseId(data[0].id);
      }
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setLoadingCourses(false);
    }
  }

  async function loadLessons(courseId: string) {
    if (!courseId) {
      setLessons([]);
      return;
    }

    setLoadingLessons(true);
    try {
      const response = await fetch(`/api/masterclass/admin/lessons?courseId=${courseId}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error("Não foi possível carregar aulas.");
      }
      const data = (await response.json()) as Lesson[];
      setLessons(data);
      setLessonForm((current) => ({
        ...current,
        position: (data[data.length - 1]?.position ?? 0) + 1,
      }));
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setLoadingLessons(false);
    }
  }

  useEffect(() => {
    loadCourses();
  }, []);

  useEffect(() => {
    if (selectedCourseId) {
      loadLessons(selectedCourseId);
    }
  }, [selectedCourseId]);

  async function handleCreateCourse() {
    if (!courseForm.title.trim()) {
      toast.error("Informe o título do curso.");
      return;
    }

    setSavingCourse(true);
    try {
      const response = await fetch("/api/masterclass/admin/courses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(courseForm),
      });

      if (!response.ok) {
        throw new Error("Falha ao criar curso.");
      }

      toast.success("Curso criado com sucesso.");
      setCourseForm({
        title: "",
        slug: "",
        description: "",
        published: true,
      });
      await loadCourses();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSavingCourse(false);
    }
  }

  async function handleCreateLesson() {
    if (!selectedCourseId) {
      toast.error("Selecione um curso.");
      return;
    }

    if (!lessonForm.title.trim() || !lessonForm.videoAssetId.trim()) {
      toast.error("Preencha título e video_asset_id/link.");
      return;
    }

    setSavingLesson(true);
    try {
      const response = await fetch("/api/masterclass/admin/lessons", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...lessonForm,
          courseId: selectedCourseId,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(payload?.error || "Falha ao criar aula.");
      }

      toast.success("Aula criada com sucesso.");
      setLessonForm((current) => ({
        ...current,
        title: "",
        slug: "",
        videoAssetId: "",
        supportMaterialTitle: "",
        supportMaterialUrl: "",
      }));
      await loadLessons(selectedCourseId);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSavingLesson(false);
    }
  }

  function openEditCourse(course: Course) {
    setEditingCourse(course);
    setEditCourseForm({
      title: course.title,
      slug: course.slug,
      description: course.description ?? "",
      published: course.published,
    });
  }

  async function handleUpdateCourse() {
    if (!editingCourse) return;
    if (!editCourseForm.title.trim()) {
      toast.error("Informe o título do curso.");
      return;
    }

    setUpdatingId(editingCourse.id);
    try {
      const response = await fetch(
        `/api/masterclass/admin/courses/${editingCourse.id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(editCourseForm),
        },
      );

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        if (response.status === 409) {
          throw new Error("Slug já existe para outro curso.");
        }
        throw new Error(payload?.error || "Falha ao editar curso.");
      }

      toast.success("Curso atualizado com sucesso.");
      setEditingCourse(null);
      await loadCourses();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setUpdatingId(null);
    }
  }

  async function handleDeleteCourse(course: Course) {
    setUpdatingId(course.id);
    try {
      const response = await fetch(`/api/masterclass/admin/courses/${course.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(payload?.error || "Falha ao excluir curso.");
      }

      toast.success("Curso excluído.");
      setDeletingCourse(null);
      if (selectedCourseId === course.id) {
        setSelectedCourseId("");
        setLessons([]);
      }
      await loadCourses();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setUpdatingId(null);
    }
  }

  function openEditLesson(lesson: Lesson) {
    setEditingLesson(lesson);
    setEditLessonForm({
      title: lesson.title,
      slug: lesson.slug,
      videoProvider: lesson.videoProvider,
      videoAssetId: lesson.videoAssetId,
      position: lesson.position,
      published: lesson.published,
      supportMaterialTitle: (lesson as any).supportMaterialTitle || "",
      supportMaterialUrl: (lesson as any).supportMaterialUrl || "",
    });
  }

  async function handleUpdateLesson() {
    if (!editingLesson) return;
    if (!selectedCourseId) return;

    if (!editLessonForm.title.trim() || !editLessonForm.videoAssetId.trim()) {
      toast.error("Preencha título e video_asset_id/link.");
      return;
    }

    setUpdatingId(editingLesson.id);
    try {
      const response = await fetch(
        `/api/masterclass/admin/lessons/${editingLesson.id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(editLessonForm),
        },
      );

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        if (response.status === 409) {
          throw new Error("Conflito de slug ou posição dentro do curso.");
        }
        throw new Error(payload?.error || "Falha ao editar aula.");
      }

      toast.success("Aula atualizada com sucesso.");
      setEditingLesson(null);
      await loadLessons(selectedCourseId);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setUpdatingId(null);
    }
  }

  async function handleDeleteLesson(lesson: Lesson) {
    if (!selectedCourseId) return;
    setUpdatingId(lesson.id);
    try {
      const response = await fetch(`/api/masterclass/admin/lessons/${lesson.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(payload?.error || "Falha ao excluir aula.");
      }

      toast.success("Aula excluída.");
      setDeletingLesson(null);
      await loadLessons(selectedCourseId);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setUpdatingId(null);
    }
  }

  async function saveOrder(nextLessons: Lesson[]) {
    if (!selectedCourseId) {
      return;
    }
    setLessons(nextLessons);
    try {
      const response = await fetch("/api/masterclass/admin/lessons/reorder", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          courseId: selectedCourseId,
          lessonIdsInOrder: nextLessons.map((lesson) => lesson.id),
        }),
      });
      if (!response.ok) {
        throw new Error("Falha ao reordenar aulas.");
      }
    } catch (error) {
      toast.error((error as Error).message);
      loadLessons(selectedCourseId);
    }
  }

  function moveLesson(index: number, direction: -1 | 1) {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= lessons.length) {
      return;
    }

    const reordered = [...lessons];
    const [item] = reordered.splice(index, 1);
    reordered.splice(newIndex, 0, item);

    const normalized = reordered.map((lesson, idx) => ({
      ...lesson,
      position: idx + 1,
    }));

    saveOrder(normalized);
  }

  const selectedCourse = useMemo(
    () => courses.find((course) => course.id === selectedCourseId) ?? null,
    [courses, selectedCourseId],
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Masterclass Admin</h1>
          <p className="text-sm text-muted-foreground">
            Cadastre cursos e aulas para aparecer no frontend automaticamente.
          </p>
        </div>
        <Button variant="outline" onClick={loadCourses} disabled={loadingCourses}>
          <RefreshCcw className="h-4 w-4" />
          Atualizar
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Novo curso</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              placeholder="Título do curso"
              value={courseForm.title}
              onChange={(event) =>
                setCourseForm((current) => ({ ...current, title: event.target.value }))
              }
            />
            <Input
              placeholder="Slug (opcional)"
              value={courseForm.slug}
              onChange={(event) =>
                setCourseForm((current) => ({ ...current, slug: event.target.value }))
              }
            />
            <Input
              placeholder="Descrição (opcional)"
              value={courseForm.description}
              onChange={(event) =>
                setCourseForm((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={courseForm.published}
                onChange={(event) =>
                  setCourseForm((current) => ({
                    ...current,
                    published: event.target.checked,
                  }))
                }
              />
              Publicado
            </label>
            <Button onClick={handleCreateCourse} disabled={savingCourse}>
              <Plus className="h-4 w-4" />
              Criar curso
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Nova aula</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <select
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={selectedCourseId}
                onChange={(event) => setSelectedCourseId(event.target.value)}
              >
                <option value="">Selecione o curso</option>
                {courses.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.title}
                  </option>
                ))}
              </select>
              <Button
                size="icon"
                variant="outline"
                onClick={() => selectedCourse && openEditCourse(selectedCourse)}
                disabled={!selectedCourse || updatingId === selectedCourse?.id}
                aria-label="Editar curso"
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="outline"
                className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-red-900/60 dark:text-red-400 dark:hover:bg-red-950/30"
                onClick={() => selectedCourse && setDeletingCourse(selectedCourse)}
                disabled={!selectedCourse || updatingId === selectedCourse?.id}
                aria-label="Excluir curso"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            <Input
              placeholder="Título da aula"
              value={lessonForm.title}
              onChange={(event) =>
                setLessonForm((current) => ({ ...current, title: event.target.value }))
              }
            />
            <Input
              placeholder="Slug da aula (opcional)"
              value={lessonForm.slug}
              onChange={(event) =>
                setLessonForm((current) => ({ ...current, slug: event.target.value }))
              }
            />
            <select
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={lessonForm.videoProvider}
              onChange={(event) =>
                setLessonForm((current) => ({
                  ...current,
                  videoProvider: event.target.value as Lesson["videoProvider"],
                }))
              }
            >
              <option value="youtube">YouTube</option>
              <option value="mux">Mux</option>
              <option value="cloudflare">Cloudflare</option>
            </select>
            <Input
              placeholder="Video ID ou link"
              value={lessonForm.videoAssetId}
              onChange={(event) =>
                setLessonForm((current) => ({
                  ...current,
                  videoAssetId: event.target.value,
                }))
              }
            />
            <Input
              type="number"
              min={1}
              value={lessonForm.position}
              onChange={(event) =>
                setLessonForm((current) => ({
                  ...current,
                  position: Number(event.target.value || "1"),
                }))
              }
              placeholder="Posição"
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={lessonForm.published}
                onChange={(event) =>
                  setLessonForm((current) => ({
                    ...current,
                    published: event.target.checked,
                  }))
                }
              />
              Publicada
            </label>
            <div className="border-t pt-4 mt-2">
              <h4 className="text-sm font-medium mb-4">Material de Apoio (Opcional)</h4>
              <div className="grid gap-4">
                <div className="grid gap-2">
                  <label htmlFor="lessonMaterialTitle" className="text-sm font-medium">Nome do Material (ex: Baixar PDF)</label>
                  <Input
                    id="lessonMaterialTitle"
                    value={lessonForm.supportMaterialTitle}
                    onChange={(e) =>
                      setLessonForm((current) => ({
                        ...current,
                        supportMaterialTitle: e.target.value,
                      }))
                    }
                    placeholder="Nome do botão ou material"
                  />
                </div>
                <div className="grid gap-2">
                  <label htmlFor="lessonMaterialUrl" className="text-sm font-medium">URL do Arquivo (Google Drive, Notion, etc)</label>
                  <Input
                    id="lessonMaterialUrl"
                    value={lessonForm.supportMaterialUrl}
                    onChange={(e) =>
                      setLessonForm((current) => ({
                        ...current,
                        supportMaterialUrl: e.target.value,
                      }))
                    }
                    placeholder="https://..."
                  />
                </div>
              </div>
            </div>
            <Button onClick={handleCreateLesson} disabled={savingLesson || !selectedCourseId}>
              <Plus className="h-4 w-4" />
              Criar aula
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            Aulas do curso{" "}
            <span className="text-muted-foreground">
              {selectedCourse ? `(${selectedCourse.title})` : ""}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!selectedCourseId ? (
            <p className="text-sm text-muted-foreground">Selecione um curso para ver as aulas.</p>
          ) : loadingLessons ? (
            <p className="text-sm text-muted-foreground">Carregando aulas...</p>
          ) : lessons.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma aula cadastrada.</p>
          ) : (
            <ul className="space-y-2">
              {lessons.map((lesson, index) => (
                <li
                  key={lesson.id}
                  className="flex items-center justify-between rounded-xl border p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {lesson.position}. {lesson.title}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {lesson.videoProvider}: {lesson.videoAssetId}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={lesson.published ? "default" : "secondary"}>
                      {lesson.published ? "Publicado" : "Rascunho"}
                    </Badge>
                    <Button
                      size="icon"
                      variant="outline"
                      onClick={() => openEditLesson(lesson)}
                      disabled={updatingId === lesson.id}
                      aria-label="Editar aula"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="outline"
                      className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-red-900/60 dark:text-red-400 dark:hover:bg-red-950/30"
                      onClick={() => setDeletingLesson(lesson)}
                      disabled={updatingId === lesson.id}
                      aria-label="Excluir aula"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="outline"
                      onClick={() => moveLesson(index, -1)}
                      disabled={index === 0}
                    >
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="outline"
                      onClick={() => moveLesson(index, 1)}
                      disabled={index === lessons.length - 1}
                    >
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={Boolean(editingCourse)}
        onOpenChange={(open) => {
          if (!open) setEditingCourse(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar curso</DialogTitle>
            <DialogDescription>
              Atualize título, slug, descrição e status de publicação.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="Título do curso"
              value={editCourseForm.title}
              onChange={(event) =>
                setEditCourseForm((current) => ({
                  ...current,
                  title: event.target.value,
                }))
              }
            />
            <Input
              placeholder="Slug (opcional)"
              value={editCourseForm.slug}
              onChange={(event) =>
                setEditCourseForm((current) => ({
                  ...current,
                  slug: event.target.value,
                }))
              }
            />
            <Input
              placeholder="Descrição (opcional)"
              value={editCourseForm.description}
              onChange={(event) =>
                setEditCourseForm((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={editCourseForm.published}
                onChange={(event) =>
                  setEditCourseForm((current) => ({
                    ...current,
                    published: event.target.checked,
                  }))
                }
              />
              Publicado
            </label>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditingCourse(null)}
              disabled={updatingId === editingCourse?.id}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={handleUpdateCourse}
              disabled={updatingId === editingCourse?.id}
            >
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(deletingCourse)}
        onOpenChange={(open) => {
          if (!open) setDeletingCourse(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir curso?</AlertDialogTitle>
            <AlertDialogDescription>
              O curso "{deletingCourse?.title}" e todas as aulas relacionadas serão removidos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={updatingId === deletingCourse?.id}>
              Cancelar
            </AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              onClick={() => deletingCourse && handleDeleteCourse(deletingCourse)}
              disabled={updatingId === deletingCourse?.id}
            >
              Excluir
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={Boolean(editingLesson)}
        onOpenChange={(open) => {
          if (!open) setEditingLesson(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar aula</DialogTitle>
            <DialogDescription>
              Atualize dados da aula e a posição dentro do curso.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="Título da aula"
              value={editLessonForm.title}
              onChange={(event) =>
                setEditLessonForm((current) => ({
                  ...current,
                  title: event.target.value,
                }))
              }
            />
            <Input
              placeholder="Slug da aula (opcional)"
              value={editLessonForm.slug}
              onChange={(event) =>
                setEditLessonForm((current) => ({
                  ...current,
                  slug: event.target.value,
                }))
              }
            />
            <select
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={editLessonForm.videoProvider}
              onChange={(event) =>
                setEditLessonForm((current) => ({
                  ...current,
                  videoProvider: event.target.value as Lesson["videoProvider"],
                }))
              }
            >
              <option value="youtube">YouTube</option>
              <option value="mux">Mux</option>
              <option value="cloudflare">Cloudflare</option>
            </select>
            <Input
              placeholder="Video ID ou link"
              value={editLessonForm.videoAssetId}
              onChange={(event) =>
                setEditLessonForm((current) => ({
                  ...current,
                  videoAssetId: event.target.value,
                }))
              }
            />
            <Input
              type="number"
              min={1}
              value={editLessonForm.position}
              onChange={(event) =>
                setEditLessonForm((current) => ({
                  ...current,
                  position: Number(event.target.value || "1"),
                }))
              }
              placeholder="Posição"
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={editLessonForm.published}
                onChange={(event) =>
                  setEditLessonForm((current) => ({
                    ...current,
                    published: event.target.checked,
                  }))
                }
              />
              Publicada
            </label>
            <div className="border-t pt-4 mt-2">
              <h4 className="text-sm font-medium mb-4">Material de Apoio (Opcional)</h4>
              <div className="grid gap-4">
                <div className="grid gap-2">
                  <label htmlFor="editLessonMaterialTitle" className="text-sm font-medium">Nome do Material (ex: Baixar PDF)</label>
                  <Input
                    id="editLessonMaterialTitle"
                    value={editLessonForm.supportMaterialTitle}
                    onChange={(e) =>
                      setEditLessonForm((current) => ({
                        ...current,
                        supportMaterialTitle: e.target.value,
                      }))
                    }
                    placeholder="Nome do botão ou material"
                  />
                </div>
                <div className="grid gap-2">
                  <label htmlFor="editLessonMaterialUrl" className="text-sm font-medium">URL do Arquivo (Google Drive, Notion, etc)</label>
                  <Input
                    id="editLessonMaterialUrl"
                    value={editLessonForm.supportMaterialUrl}
                    onChange={(e) =>
                      setEditLessonForm((current) => ({
                        ...current,
                        supportMaterialUrl: e.target.value,
                      }))
                    }
                    placeholder="https://..."
                  />
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditingLesson(null)}
              disabled={updatingId === editingLesson?.id}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={handleUpdateLesson}
              disabled={updatingId === editingLesson?.id}
            >
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(deletingLesson)}
        onOpenChange={(open) => {
          if (!open) setDeletingLesson(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir aula?</AlertDialogTitle>
            <AlertDialogDescription>
              A aula "{deletingLesson?.title}" será removida do curso.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={updatingId === deletingLesson?.id}>
              Cancelar
            </AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              onClick={() => deletingLesson && handleDeleteLesson(deletingLesson)}
              disabled={updatingId === deletingLesson?.id}
            >
              Excluir
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
