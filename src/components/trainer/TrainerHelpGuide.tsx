import { useTranslation, Trans } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  BookOpen,
  Users,
  CalendarDays,
  Dumbbell,
  Megaphone,
  ClipboardList,
  MessageCircle,
  Ticket,
  Smartphone,
  AlertTriangle,
  ListChecks,
  CreditCard,
} from "lucide-react";

const TrainerHelpGuide = () => {
  const { t } = useTranslation();
  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
            <BookOpen className="w-4 h-4 text-accent" />
          </div>
          <div>
            <h3 className="font-bold text-sm">{t("help.title")}</h3>
            <p className="text-xs text-muted-foreground">
              {t("help.subtitle")}
            </p>
          </div>
        </div>

        <Accordion type="single" collapsible className="w-full">
          <AccordionItem value="basics">
            <AccordionTrigger className="text-sm font-bold">
              <span className="flex items-center gap-2">
                <ListChecks className="w-4 h-4 text-accent" />
                {t("help.section1Title")}
              </span>
            </AccordionTrigger>
            <AccordionContent className="text-sm text-muted-foreground space-y-3 pt-2">
              <p>{t("help.section1Intro")}</p>
              <ul className="space-y-2">
                <li className="flex gap-2">
                  <Users className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                  <span>
                    <b className="text-foreground">{t("help.section1Clients")}</b>{t("help.section1ClientsDesc")}
                  </span>
                </li>
                <li className="flex gap-2">
                  <CalendarDays className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                  <span>
                    <b className="text-foreground">{t("help.section1Schedule")}</b>{t("help.section1ScheduleDesc")}
                  </span>
                </li>
                <li className="flex gap-2">
                  <Dumbbell className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                  <span>
                    <b className="text-foreground">{t("help.section1Exercise")}</b>{t("help.section1ExerciseDesc")}
                  </span>
                </li>
                <li className="flex gap-2">
                  <Megaphone className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                  <span>
                    <b className="text-foreground">{t("help.section1Announcement")}</b>{t("help.section1AnnouncementDesc")}
                  </span>
                </li>
                <li className="flex gap-2">
                  <ClipboardList className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                  <span>
                    <b className="text-foreground">{t("help.section1Counseling")}</b>{t("help.section1CounselingDesc")}
                  </span>
                </li>
                <li className="flex gap-2">
                  <MessageCircle className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                  <span>
                    <b className="text-foreground">{t("help.section1Message")}</b>{t("help.section1MessageDesc")}
                  </span>
                </li>
              </ul>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="invite">
            <AccordionTrigger className="text-sm font-bold">
              <span className="flex items-center gap-2">
                <Ticket className="w-4 h-4 text-accent" />
                {t("help.section2Title")}
              </span>
            </AccordionTrigger>
            <AccordionContent className="text-sm text-muted-foreground space-y-3 pt-2">
              <p>
                {t("help.section2Intro1")}<b className="text-foreground">{t("help.section2InviteCode")}</b>{t("help.section2Intro2")}
              </p>
              <ol className="space-y-3 list-decimal list-inside">
                <li>
                  <b className="text-foreground">{t("help.section2Step1")}</b>
                  <p className="ml-5 mt-1">
                    {t("help.section2Step1Desc", { path: "/join/コード" })}
                  </p>
                </li>
                <li>
                  <b className="text-foreground">{t("help.section2Step2")}</b>
                  <p className="ml-5 mt-1">{t("help.section2Step2Desc")}</p>
                </li>
                <li>
                  <b className="text-foreground">{t("help.section2Step3")}</b>
                  <p className="ml-5 mt-1">{t("help.section2Step3Desc")}</p>
                </li>
                <li>
                  <b className="text-foreground">{t("help.section2Step4")}</b>
                  <p className="ml-5 mt-1">{t("help.section2Step4Desc")}</p>
                </li>
                <li>
                  <b className="text-foreground">{t("help.section2Step5")}</b>
                  <p className="ml-5 mt-1">{t("help.section2Step5Desc")}</p>
                </li>
                <li>
                  <b className="text-foreground">{t("help.section2Step6")}</b>
                  <p className="ml-5 mt-1">{t("help.section2Step6Desc")}</p>
                </li>
              </ol>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="customer-features">
            <AccordionTrigger className="text-sm font-bold">
              <span className="flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-accent" />
                {t("help.section3Title")}
              </span>
            </AccordionTrigger>
            <AccordionContent className="text-sm text-muted-foreground space-y-2 pt-2">
              <ul className="space-y-2 list-disc list-inside">
                <li>{t("help.section3Item1")}</li>
                <li>{t("help.section3Item2")}</li>
                <li>{t("help.section3Item3")}</li>
                <li>{t("help.section3Item4")}</li>
                <li>{t("help.section3Item5")}</li>
                <li>{t("help.section3Item6")}</li>
                <li>{t("help.section3Item7")}</li>
              </ul>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="troubleshooting">
            <AccordionTrigger className="text-sm font-bold">
              <span className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-accent" />
                {t("help.section4Title")}
              </span>
            </AccordionTrigger>
            <AccordionContent className="text-sm text-muted-foreground space-y-2 pt-2">
              <ul className="space-y-2 list-disc list-inside">
                <li><b className="text-foreground">{t("help.section4Item1Title")}</b>{t("help.section4Item1Desc")}</li>
                <li><b className="text-foreground">{t("help.section4Item2Title")}</b>{t("help.section4Item2Desc")}</li>
                <li><b className="text-foreground">{t("help.section4Item3Title")}</b>{t("help.section4Item3Desc")}</li>
                <li><b className="text-foreground">{t("help.section4Item4Title")}</b>{t("help.section4Item4Desc")}</li>
                <li><b className="text-foreground">{t("help.section4Item5Title")}</b>{t("help.section4Item5Desc")}</li>
              </ul>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="plan-subscription">
            <AccordionTrigger className="text-sm font-bold">
              <span className="flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-accent" />
                {t("help.section5Title")}
              </span>
            </AccordionTrigger>
            <AccordionContent className="text-sm text-muted-foreground space-y-3 pt-2">
              <p>{t("help.section5Intro")}</p>
              <ol className="space-y-3 list-decimal list-inside">
                <li>
                  <b className="text-foreground">{t("help.section5Step1")}</b>
                  <p className="ml-5 mt-1">
                    {t("help.section5Step1Desc", { url: "https://gymboard.lovable.app" })}
                  </p>
                </li>
                <li>
                  <b className="text-foreground">{t("help.section5Step2")}</b>
                  <p className="ml-5 mt-1">{t("help.section5Step2Desc")}</p>
                </li>
                <li>
                  <b className="text-foreground">{t("help.section5Step3")}</b>
                  <p className="ml-5 mt-1">{t("help.section5Step3Desc")}</p>
                </li>
                <li>
                  <b className="text-foreground">{t("help.section5Step4")}</b>
                  <p className="ml-5 mt-1">{t("help.section5Step4Desc")}</p>
                </li>
                <li>
                  <b className="text-foreground">{t("help.section5Step5")}</b>
                  <p className="ml-5 mt-1">{t("help.section5Step5Desc")}</p>
                </li>
              </ol>
              <p className="text-xs">
                <b className="text-foreground">{t("help.section5Notice")}</b>{t("help.section5NoticeDesc")}
              </p>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>
    </Card>
  );
};

export default TrainerHelpGuide;
