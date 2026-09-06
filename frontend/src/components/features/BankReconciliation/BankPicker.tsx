import { useAtom, useSetAtom } from "jotai"
import { SelectedBank, selectedBankAccountAtom } from "./bankRecAtoms"
import { useCallback, useMemo, useState } from "react"
import { useGetBankAccounts, useGetUnreconciledTransactions } from "./utils"
import { cn } from "@/lib/utils"
import { Landmark, Search } from "lucide-react"
import { H4 } from "@/components/ui/typography"
import { getTimeago } from "@/lib/date"
import ErrorBanner from "@/components/ui/error-banner"
import { Input } from "@/components/ui/input"
import Fuse from "fuse.js"
import _ from "@/lib/translate"

const BankPicker = ({ className, size = 'base' }: { className?: string, size?: 'base' | 'sm' }) => {

    const setSelectedBank = useSetAtom(selectedBankAccountAtom)

    const onLoadingSuccess = useCallback((data?: SelectedBank[]) => {
        if (!data) return
        if (data.length === 1) {
            setSelectedBank(data[0])
        } else if (data.length > 1) {
            const defaultBank = data.find((bank: SelectedBank) => bank.is_default)
            if (defaultBank) {
                setSelectedBank(defaultBank)
            }
        }
    }, [setSelectedBank])

    const { banks, isLoading, error } = useGetBankAccounts(onLoadingSuccess)

    const [bankSearch, setBankSearch] = useState('')

    const bankSearchIndex = useMemo(() => {
        if (!banks) {
            return null
        }
        return new Fuse(banks, {
            keys: ['account_name', 'bank', 'bank_account_no'],
            threshold: 0.4,
            includeScore: true
        })
    }, [banks])

    const filteredBanks = useMemo(() => {
        if (!bankSearchIndex || !bankSearch || !banks) {
            return banks ?? []
        }
        const matches = bankSearchIndex.search(bankSearch).map((result) => result.item)
        const matchedNames = new Set(matches.map((bank) => bank.name))
        const rest = banks.filter((bank) => !matchedNames.has(bank.name))
        return [...matches, ...rest]
    }, [bankSearchIndex, bankSearch, banks])

    if (isLoading) {
        return null
    }

    if (error) {
        return <ErrorBanner error={error} />
    }
    return (
        <div className={cn("flex flex-col gap-2 w-full", className)}>
            <div className="flex w-full gap-2">
                <label className="sr-only">{_("Search bank accounts")}</label>
                <div className={cn("flex items-center gap-2 w-full max-w-sm rounded-md dark:bg-input/30 border-input border bg-transparent px-2 text-base shadow-xs transition-[color,box-shadow] outline-none",
                    "focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px]"
                )}>
                    <Search className="w-5 h-5 text-muted-foreground" />
                    <Input placeholder={_("Search bank accounts")} type='search' onChange={(e) => setBankSearch(e.target.value)} defaultValue={bankSearch}
                        className="border-none px-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0" />
                </div>
            </div>
            <div
                className={cn("flex gap-3 items-stretch w-full overflow-x-auto bank-picker-scrollbar pr-4",
                    banks?.length > 4 ? 'pb-2' : ''
                )}
                style={{
                    scrollbarWidth: 'thin',
                    scrollbarColor: 'rgb(209 213 219) rgb(243 244 246)',
                }}
            >
                {
                    filteredBanks.map((bank) => (
                        <BankPickerItem key={bank.name} bank={bank} size={size} />
                    ))
                }
            </div>
        </div>
    )
}

const BankPickerItem = ({ bank, size = 'base' }: { bank: SelectedBank, size?: 'base' | 'sm' }) => {

    const [selectedBank, setSelectedBank] = useAtom(selectedBankAccountAtom)

    const isSelected = selectedBank?.name === bank.name

    const { mutate } = useGetUnreconciledTransactions()

    const onSelect = () => {
        setSelectedBank(bank)
        mutate()
    }

    return <div
        role="button"
        title={`Select ${bank.account_name}`}
        onClick={onSelect}
        className={cn('rounded-md border-2 border-gray-200 min-w-80 relative p-2 bg-card overflow-hidden cursor-pointer',
            isSelected ? 'border-primary bg-primary-foreground' : 'hover:bg-gray-50',
            {
                "max-w-60 min-w-60": size === 'sm',
            }
        )}
    >
        {bank.logo ? <img
            src={`/assets/mint/mint/${bank.logo}`}
            alt={bank.bank || bank.name || ''}
            className={cn("max-w-24 object-left h-10 object-contain mb-1", {
                'h-6 max-w-18 mb-2': size === 'sm',
            })}
        /> : <div className={cn("rounded-md flex items-center h-10 gap-2", {
            "h-6 mb-2": size === 'sm',
        })}>
            <Landmark size={size === 'sm' ? '16px' : '30px'} />
            <H4 className={cn("text-base mb-0", {
                'text-xs': size === 'sm',
            })}>{bank.bank}</H4>
        </div>}

        <div className="flex flex-col gap-0.5">
            <span className={cn("tracking-tight font-medium", {
                'text-xs': size === 'sm',
            })}>{bank.account_name}</span>
            <span title={_("GL Account")} className={cn("text-ellipsis line-clamp-1", size === 'sm' ? 'text-xs' : "text-sm")}>{bank.account}</span>
            {bank.last_integration_date && size !== 'sm' && <span className="text-xs text-muted-foreground">{_("Last Synced Transaction")}: {getTimeago(bank.last_integration_date)}</span>}
        </div>

        <div className={cn("absolute -top-1 right-0", {
            "-top-1.5": size === 'sm',
        })}>
            {bank.account_type && <span className={cn("uppercase rounded-bl-sm text-xs tracking-tight font-semibold py-1 px-1.5",
                isSelected ? 'bg-primary text-primary-foreground' : 'bg-gray-200 text-secondary-foreground/70',
                {
                    'text-[10px]': size === 'sm',
                }
            )}>
                {bank.account_type?.slice(0, 24)}
            </span>}
        </div>

    </div >
}

export default BankPicker