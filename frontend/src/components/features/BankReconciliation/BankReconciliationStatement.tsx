import { useAtomValue } from "jotai"
import { MissingFiltersBanner } from "./MissingFiltersBanner"
import { bankRecDateAtom, selectedBankAccountAtom } from "./bankRecAtoms"
import { useCurrentCompany } from "@/hooks/useCurrentCompany"
import { Paragraph } from "@/components/ui/typography"
import { useMemo } from "react"
import { useFrappeGetCall } from "frappe-react-sdk"
import { QueryReportReturnType } from "@/types/custom/Reports"
import { formatDate } from "@/lib/date"
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatCurrency } from "@/lib/numbers"
import { getCompanyCurrency } from "@/lib/company"
import { slug } from "@/lib/frappe"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { AlertCircle, Download } from "lucide-react"
import ErrorBanner from "@/components/ui/error-banner"
import { StatContainer, StatLabel, StatValue } from "@/components/ui/stats"
import _ from "@/lib/translate"
import { toast } from "sonner"
import { useCopyToClipboard } from "usehooks-ts"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Button } from "@/components/ui/button"

/** CSV-escapes a single field: wraps in quotes if it contains a comma, quote or newline. */
const csvField = (value: string | number | null | undefined): string => {
    const str = String(value ?? "")
    if (/[",\n]/.test(str)) {
        return `"${str.replace(/"/g, '""')}"`
    }
    return str
}

/** Strips the leading account number and trailing company abbreviation from an
 * Account name like "1-250206 - NDB Bank - C/A No: 101000652556 - SGSPL",
 * leaving just "NDB Bank - C/A No: 101000652556". Account names follow
 * Frappe's "<account_number> - <account_name> - <company_abbr>" convention;
 * the account_name itself may contain further " - " segments, so only the
 * first (account number) and last (company abbr) segments are dropped. */
const friendlyAccountLabel = (accountLabel: string): string => {
    const parts = accountLabel.split(" - ")
    if (parts.length >= 3) {
        return parts.slice(1, -1).join(" - ")
    }
    if (parts.length === 2) {
        return parts[0]
    }
    return accountLabel
}

/** Downloads the statement as a CSV, with the bank account and date range shown
 * as header rows -- the report's own filters aren't otherwise visible once the
 * file is downloaded and separated from the page. */
const downloadStatementCsv = (bankAccountLabel: string, fromDate: string, toDate: string, rows: BankClearanceSummaryEntry[]) => {
    const friendlyLabel = friendlyAccountLabel(bankAccountLabel)

    const headerRows = [
        ["Bank Reconciliation Statement"],
        ["Bank Account", friendlyLabel],
        ["Period", `${formatDate(fromDate)} to ${formatDate(toDate)}`],
        [],
        ["Posting Date", "Document Type", "Payment Document", "Debit", "Credit", "Against Account", "Reference #", "Reference Date", "Clearance Date"],
    ]

    const dataRows = rows
        .filter((row) => row.payment_entry)
        .map((row) => [
            formatDate(row.posting_date),
            row.payment_document,
            row.payment_entry,
            row.debit,
            row.credit,
            row.against_account,
            row.reference_no,
            formatDate(row.ref_date),
            formatDate(row.clearance_date),
        ])

    const csv = [...headerRows, ...dataRows]
        .map((row) => row.map(csvField).join(","))
        .join("\n")

    // "C/A No: ..." style labels contain characters invalid in filenames on some OSes.
    const safeFilenameLabel = friendlyLabel.replace(/[/\\:*?"<>|]/g, "-")

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `Bank Reconciliation Statement - ${safeFilenameLabel} - ${toDate}.csv`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
}

const BankReconciliationStatement = () => {
    const bankAccount = useAtomValue(selectedBankAccountAtom)
    const dates = useAtomValue(bankRecDateAtom)

    if (!bankAccount) {
        return <MissingFiltersBanner text={_("Please select a bank account to view the bank reconciliation statement.")} />
    }

    if (!dates) {
        return <MissingFiltersBanner text={_("Please select dates to view the bank reconciliation statement.")} />
    }

    return <BankReconciliationStatementView />
}
interface BankClearanceSummaryEntry {
    payment_document: string
    payment_entry: string
    posting_date: string,
    reference_no: string,
    credit: number,
    debit: number,
    against_account: string,
    ref_date: string,
    account_currency: string,
    clearance_date: string
}

const BankReconciliationStatementView = () => {

    const companyID = useCurrentCompany()
    const bankAccount = useAtomValue(selectedBankAccountAtom)
    const dates = useAtomValue(bankRecDateAtom)

    const filters = useMemo(() => {
        return JSON.stringify({
            account: bankAccount?.account,
            report_date: dates.toDate,
            company: companyID
        })
    }, [bankAccount, dates, companyID])

    const { data, error } = useFrappeGetCall<{ message: QueryReportReturnType }>('frappe.desk.query_report.run', {
        report_name: 'Bank Reconciliation Statement',
        filters,
        ignore_prepared_report: 1,
        are_default_filters: false,
    }, `Report-Bank Reconciliation Statement-${filters}`, { keepPreviousData: true, revalidateOnFocus: false }, 'POST')

    const [, copyToClipboard] = useCopyToClipboard()

    const onCopy = (text: string) => {
        copyToClipboard(text)
            .then(() => {
                toast.success(_("Copied to clipboard"))
            })
    }


    return <div className="space-y-4 py-2">

        <div className="flex items-start justify-between gap-4">
            <Paragraph className="text-sm">
                <span dangerouslySetInnerHTML={{
                    __html: _("Below is a list of all entries posted against the bank account {0} which have not been cleared till {1}.", [`<strong>${bankAccount?.account}</strong>`, `<strong>${formatDate(dates.toDate)}</strong>`])
                }} />
            </Paragraph>
            {data && data.message.result.length > 0 &&
                <Button variant="outline" size="sm" className="shrink-0"
                    onClick={() => downloadStatementCsv(bankAccount?.account ?? "", dates.fromDate, dates.toDate, data.message.result)}>
                    <Download className="w-4 h-4" /> {_("Download")}
                </Button>
            }
        </div>

        {error && <ErrorBanner error={error} />}

        {data && <SummarySection data={data} />}

        {data && data.message.result.length > 0 &&
            <Table>
                <TableCaption>{_("Bank Reconciliation Statement")}</TableCaption>
                <TableHeader>
                    <TableRow>
                        <TableHead>{_("Posting Date")}</TableHead>
                        <TableHead>{_("Document Type")}</TableHead>
                        <TableHead>{_("Payment Document")}</TableHead>
                        <TableHead className="text-right">{_("Debit")}</TableHead>
                        <TableHead className='text-right'>{_("Credit")}</TableHead>
                        <TableHead>{_("Against Account")}</TableHead>
                        <TableHead>{_("Reference #")}</TableHead>
                        <TableHead>{_("Reference Date")}</TableHead>
                        <TableHead>{_("Clearance Date")}</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {data.message.result.map((row: BankClearanceSummaryEntry, index) => {

                        if (!row.payment_entry) return <TableRow key={index} />

                        return <TableRow key={row.payment_entry}>
                            <TableCell>{formatDate(row.posting_date)}</TableCell>
                            <TableCell>{_(row.payment_document)}</TableCell>
                            <TableCell>
                                {row.payment_document ?
                                    <a target="_blank" className="underline underline-offset-4" href={`/app/${slug(row.payment_document)}/${row.payment_entry}`}>{row.payment_entry}</a>
                                    :
                                    row.payment_entry}
                            </TableCell>
                            <TableCell className="text-right">{formatCurrency(row.debit, row.account_currency)}</TableCell>
                            <TableCell className="text-right">{formatCurrency(row.credit, row.account_currency)}</TableCell>
                            <TableCell className="max-w-[250px] overflow-hidden text-ellipsis whitespace-nowrap" title={row.against_account}><a target="_blank" className="underline underline-offset-4" href={`/app/account/${row.against_account}`}>{row.against_account}</a></TableCell>
                            <TableCell>
                                <Tooltip delayDuration={500}>
                                    <TooltipTrigger onClick={() => onCopy(row.reference_no)}>
                                        {row.reference_no?.slice(0, 40)}{row.reference_no?.length > 40 ? "..." : ""}
                                    </TooltipTrigger>
                                    <TooltipContent align='start'>
                                        {_("Copy to clipboard")}
                                    </TooltipContent>
                                </Tooltip>
                            </TableCell>
                            <TableCell>{formatDate(row.ref_date)}</TableCell>
                            <TableCell>{formatDate(row.clearance_date)}</TableCell>
                        </TableRow>
                    }
                    )}
                </TableBody>
            </Table>}

        {data && data.message.result.length === 0 &&
            <Alert variant='default'>
                <AlertCircle />
                <AlertTitle>{_("No entries found")}</AlertTitle>
                <AlertDescription>
                    {_("There are no accounting entries in the system for the selected account and dates.")}
                </AlertDescription>
            </Alert>
        }


    </div>
}

const SummarySection = ({ data }: { data: { message: QueryReportReturnType } }) => {

    const company = useCurrentCompany()
    const bankAccount = useAtomValue(selectedBankAccountAtom)

    const { bankStatementBalanceAsPerGL, outstandingChecksDebit, outstandingChecksCredit, incorrectlyClearedEntriesDebit, incorrectlyClearedEntriesCredit, calculatedBankStatementBalance } = useMemo(() => {

        // Loop over the results and find the corresponding rows

        let bankStatementBalanceAsPerGL = 0

        let outstandingChecksDebit = 0
        let outstandingChecksCredit = 0

        let incorrectlyClearedEntriesDebit = 0
        let incorrectlyClearedEntriesCredit = 0

        let calculatedBankStatementBalance = 0

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data?.message.result.forEach((r: any) => {
            if (r.payment_entry === 'Bank Statement balance as per General Ledger') {
                bankStatementBalanceAsPerGL = r.debit - r.credit
            }

            if (r.payment_entry === 'Outstanding Checks and Deposits to clear') {
                outstandingChecksDebit = r.debit
                outstandingChecksCredit = r.credit
            }

            if (r.payment_entry === 'Checks and Deposits incorrectly cleared') {
                incorrectlyClearedEntriesDebit = r.debit
                incorrectlyClearedEntriesCredit = r.credit
            }

            if (r.payment_entry === 'Calculated Bank Statement balance') {
                calculatedBankStatementBalance = r.debit - r.credit
            }
        })

        return {
            bankStatementBalanceAsPerGL,
            outstandingChecksDebit,
            outstandingChecksCredit,
            incorrectlyClearedEntriesDebit,
            incorrectlyClearedEntriesCredit,
            calculatedBankStatementBalance
        }

    }, [data])

    const currency = bankAccount?.account_currency ?? getCompanyCurrency(company)

    return <div className="flex gap-4 items-start justify-between">
        <StatContainer>
            <StatLabel>{_("Bank Statement Balance as per General Ledger")}</StatLabel>
            <StatValue className="font-mono">{formatCurrency(bankStatementBalanceAsPerGL, currency)}</StatValue>
        </StatContainer>

        <StatContainer>
            <StatLabel>{_("Outstanding Checks and Deposits to clear")}</StatLabel>
            <StatValue className="font-mono">{formatCurrency(outstandingChecksDebit - outstandingChecksCredit, currency)}</StatValue>
        </StatContainer>

        {(incorrectlyClearedEntriesDebit > 0 || incorrectlyClearedEntriesCredit > 0) && <StatContainer>
            <StatLabel className="text-destructive">{_("Checks and Deposits incorrectly cleared")}</StatLabel>
            <StatValue className="text-destructive font-mono">{formatCurrency(incorrectlyClearedEntriesDebit - incorrectlyClearedEntriesCredit)}</StatValue>
            {/* <div className="" divider={<StackDivider height='20px' />}>
                {incorrectlyClearedEntriesDebit !== 0 && <StatHelpText>Debit: {formatCurrency(incorrectlyClearedEntriesDebit)}</StatHelpText>}
                {incorrectlyClearedEntriesCredit !== 0 && <StatHelpText>Credit: {formatCurrency(incorrectlyClearedEntriesCredit)}</StatHelpText>}
            </div> */}
        </StatContainer>}
        <StatContainer>
            <StatLabel>{_("Calculated Bank Statement Balance")}</StatLabel>
            <StatValue className="font-mono">{formatCurrency(calculatedBankStatementBalance)}</StatValue>
        </StatContainer>

    </div>
}

export default BankReconciliationStatement
